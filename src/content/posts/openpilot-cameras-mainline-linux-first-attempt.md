---
title: "Getting openpilot’s cameras working on mainline Linux (the first attempt)"
description: "My first CAMSS camera port: kernel-side sensor and ISP configuration, raw capture, broken lookup tables, and the unfinished openpilot integration."
pubDatetime: 2026-04-08T12:00:00Z
tags:
  - openpilot
  - linux
  - hardware
  - debugging
draft: false
featured: false
---

## Introduction

In late March 2026, I worked on getting the comma 3X cameras running on mainline Linux. This first implementation put sensor initialization and image-processing configuration inside the kernel. Openpilot would receive processed frames through V4L2, the standard Linux video interface.

I got recognizable images out of the Snapdragon 845’s image processor. Getting from those images to a dependable openpilot camera pipeline remained unfinished.

This post covers that kernel-configured version: the raw capture, the flat images, the first useful pictures, and the problems that remained when I connected it to openpilot. I began researching mainline IFE support on March 8; the implementation and tests described here took place on March 27–29, using Linux 6.18.

These comparisons show published March snapshots against master: [commaai/vamOS](https://github.com/commaai/vamOS/compare/master...f046dd46034834a2b167e6648576cce21b55c15a) and [dorapilot/openpilot](https://github.com/dorapilot/openpilot/compare/master...6fdf802f6abb5f35ca6865c0dc3a6dba6bac2516). They include other platform work from the same period; the links throughout this post point to the camera changes.

## Making the kernel produce the image

Openpilot’s existing camera path used Qualcomm’s downstream camera interfaces. The mainline CAMSS driver gave me a different starting point: Linux sensor drivers, a media graph connecting the camera hardware, and video devices from which userspace could capture frames.

My implementation divided the work like this:

| Kernel                                         | Openpilot                                            |
| ---------------------------------------------- | ---------------------------------------------------- |
| Sensor power and initialization registers      | Start and stop V4L2 capture                          |
| ISP registers, gamma, and linearization tables | Request exposure and gain through V4L2 controls      |
| Raw-to-NV12 processing and capture buffers     | Copy captured frames into VisionIPC and publish them |

The ISP is the image signal processor. Its job includes turning the sensor’s Bayer data into a color image. I extended the SDM845 CAMSS path to produce NV12, the format openpilot needed, using the VFE 170 hardware rather than software debayering.

That meant adding an OX03C10 sensor driver, wiring up camera supplies and device-tree links, and extending the receiver and VFE configuration. The production downstream code and openpilot’s register tables were essential references.

## The first fault was sixteen missing lines

Raw capture was the first useful checkpoint. Initially, the sensor produced data, but the IOMMU reported a fault while the camera hardware was writing it into memory.

I had described the frame as 1,208 lines high. The sensor actually transmitted 1,224: 1,208 image lines plus 16 metadata lines. The capture buffer did not account for the full transfer, so the hardware wrote beyond its mapped extent.

The [height fix](https://github.com/commaai/vamOS/commit/d2991a7a7fbe65c679ed646def9c9589abef86fc) made that distinction explicit:

```c
#define OX03C10_NATIVE_HEIGHT 1224 /* 1208 active + 16 metadata lines */
```

After that correction, I could capture valid raw Bayer data without the earlier fault.

I had started by looking at memory mapping because that was where the error appeared. The mistake was earlier: the driver’s description of the incoming frame was wrong. The visible image dimensions were not the dimensions of everything the sensor sent.

## A frame full of the same pixel

Raw capture did not prove the image-processing path worked. CAMSS needed additional configuration to route data through the pixel-processing path, accept Bayer input, and write NV12 output. I worked through media-format negotiation, receiver routing, output-buffer ordering, and stride alignment.

Eventually, capture returned NV12 buffers without the earlier memory faults. But the image was almost entirely one value: `Y=224`.

This was the most misleading part of the bring-up. Data was moving, buffers had the expected structure, and register readbacks looked convincing. I investigated routing, clocks, configuration order, and whether writes needed to pass through Qualcomm’s command DMA mechanism instead of direct register access.

The crucial mistake was in the processing configuration itself. I had enabled linearization and gamma processing without loading the lookup tables those blocks needed. Matching the enable registers from a working system did not reproduce the contents of its internal table memory.

I also found registers I had mislabeled as DMI configuration. They were actually raw-crop registers. The [fix](https://github.com/commaai/vamOS/commit/4569f59802dbffc7dd6ca8ab70b805a3fbbb4f06) corrected the crop setup and disabled the two processing blocks until their tables were available.

The output changed. With exposure adjusted, it contained real spatial detail, and I could turn the capture into a recognizable picture of my desk.

That was the first convincing proof that this path could process a real scene. A successful capture call and a correctly sized buffer had not been enough.

## Bringing back the missing processing

Disabling those blocks was a debugging step. The image still needed the processing I had removed.

I added [gamma-table uploads](https://github.com/commaai/vamOS/commit/2ba6ca28e4379e334aab2d8dc3b85846ba5a972b) through the ISP’s Data Memory Interface, or DMI, then [linearization tables and their control points](https://github.com/commaai/vamOS/commit/a72245c81eea81ad7e832e2a0b6f6c5c019d9a9b), using openpilot’s configuration as the reference. I also corrected the Bayer pattern used by the demux stage.

Gamma made the scene much easier to see. Exposure still mattered: one capture was too bright, and lowering exposure produced a more balanced image. A recognizable picture was progress, not proof that the tuning matched openpilot across lighting conditions.

All of this configuration lived in the kernel patch. That made the experiment self-contained, but it also meant that changing an image-processing table required rebuilding and deploying kernel code.

I used modules to shorten that loop. In practice, hung capture processes sometimes kept modules in use, and stale loaded code confused comparisons between tests. Some iterations still required a power cycle. I needed a repeatable test starting from a known state, not merely a successful module build.

Before the later integration tests, I switched the camera stack to built-in drivers so it no longer needed manual module loading. That simplified startup, but it did not resolve the remaining capture and integration problems.

## Connecting it to openpilot

The V4L2 camerad backend configured the media pipeline, requested memory-mapped capture buffers, and waited for frames. For each completed capture, it copied the image into a separate VisionIPC buffer and published it.

That copy matters. This version was not a direct, zero-copy path from the camera into openpilot’s shared buffers.

Another problem appeared at the GPU boundary. The shared-memory fallback used when `/dev/ion` was unavailable did not provide the DMA-BUF backing needed by the EGL import path. I enabled DMA heaps in the kernel and added [DMA-BUF allocation in msgq](https://github.com/dorapilot/msgq/commit/838c29e98d8b3d9bb0aee31d49356eefe11a03b6).

Then permissions undermined that change: `/dev/dma_heap/system` was accessible only to root. The ordinary openpilot user could fall back to shared memory instead. Allocation could appear successful while producing a buffer the next component could not use.

Fixing the allocation path did not remove the capture-to-VisionIPC copy, and it did not prove that the whole camera-to-model path worked.

## Where this version stopped

The March 29 logs contain successful buffer dequeues and camerad reaching its frame-publication path. They also contain capture timeouts, consumers reporting `get_stream failed`, and a camerad crash in the publication path during manual testing. The device became unreachable repeatedly during integration attempts; the surviving record does not establish one final cause for those failures.

The backend configured the two road-camera paths. It had no capture configuration for the driver camera. I had not demonstrated reliable three-camera operation, sustained model consumption, or clean repeated start/stop behavior.

So there were two different results: I had demonstrated raw capture and real ISP-processed images, but I had not finished a dependable openpilot integration.

## What I got wrong

I copied configuration without accounting for all the state behind it. The uninitialized lookup tables were the clearest example. Register readback could look right while the image was completely wrong.

I also treated component milestones too generously. Sensors probing, capture starting, buffers arriving, and the publication function being called were useful observations. Each proved less than “the cameras work.” I needed to follow identifiable frames all the way to their consumers.

Finally, I moved camera-specific tuning into the kernel without giving enough weight to the maintenance cost. That was a practical way to explore the hardware, but it created another home for values openpilot already owned. Keeping the two implementations aligned, exposing the necessary controls, and validating every change would all become part of maintaining it.

I would still keep the raw-capture and standalone-image tests. They made the hardware problems small enough to investigate. I would follow them much earlier with a single-camera test that covered capture, publication, consumer access, and restart under the same user and process setup as openpilot.

The useful result of this attempt was a real picture produced by the mainline camera stack, plus concrete fixes for the path that produced it. The unfinished part was everything required to make that picture a reliable input to openpilot.
