---
title: "Getting openpilot’s cameras working on mainline Linux"
description: "Bringing three cameras, tinygrad DMA-BUF inference, hardware encoding, and audio together on vamOS with Linux 7.2."
pubDatetime: 2026-09-19T07:17:21Z
modDatetime: 2026-09-20T20:28:17Z
tags:
  - openpilot
  - linux
  - hardware
  - debugging
draft: false
featured: false
---

## Introduction

I wanted to run openpilot on vamOS with a mainline Linux kernel and keep all three cameras under camerad’s control. Starting with dorapilot, my openpilot fork, and Trey’s Spectra camera port, I worked with Codex to bring up the three cameras and connect their frames to tinygrad’s GPU runtime through DMA-BUF.

By the final bench test, all three cameras were delivering about 20 frames per second while the driving model, driver monitoring, UI, audio, and hardware encoders ran together. The test produced 64 videos containing 75,879 decoded frames, checked against the recording logs.

The work also required fixes to GPU submission, video encoding, and audio playback. The bench results below cover testing through September 19, 2026, followed by a road test on September 20.

These links compare the published `liberation-day-7.2` branches with each repository’s `master`:

- [dorapilot/openpilot](https://github.com/dorapilot/openpilot/compare/master...liberation-day-7.2)
- [dorapilot/msgq](https://github.com/dorapilot/msgq/compare/master...liberation-day-7.2)
- [dorapilot/tinygrad](https://github.com/dorapilot/tinygrad/compare/master...liberation-day-7.2)
- [commaai/vamOS](https://github.com/commaai/vamOS/compare/master...liberation-day-7.2)
- [dorapilot/raylib](https://github.com/dorapilot/raylib/compare/master...liberation-day-7.2)
- [dorapilot/raylib-python-cffi](https://github.com/dorapilot/raylib-python-cffi/compare/master...liberation-day-7.2)

The tested follow-up fixes are now committed and pushed. The installable images are published as the [vamOS Liberation Day 7.2 release](https://github.com/commaai/vamOS/releases/tag/liberation-day-7.2), an experimental build for the comma 3X and comma four. To run it, pick Custom Software in the AGNOS setup screen and enter `https://installer.comma.ai/dorapilot/liberation-day-7.2`, which installs the branch first and lets its startup pull the OS update.

## Keeping camerad close to stock

The comma 3X was running Linux 7.2. We first rebuilt the non-camera work on a clean upstream openpilot base, then added the camera integration separately.

I kept camerad’s sensor programming, exposure control, request scheduling, and completion handling unchanged. Trey’s Spectra port provided the kernel-side foundation for that interface. The road cameras use Qualcomm’s IFE processing path; the cabin camera goes through IFE RAW and then ICP/BPS.

The resulting frame path looks like this:

```text
Three camera sensors
        ↓
Qualcomm camera processing
        ↓
NV12 frames in DMA-BUFs
        ↓
     VisionIPC
        ↓
 tinygrad / UI / encoders
```

DMA-BUF lets these components share an allocation through a file descriptor. It also leaves important questions to answer: who owns the memory, when has the producer finished, and how long does the frame remain valid?

Most kernel iteration used loadable modules. Device-tree and GPIO configuration prerequisites still required two boot-only updates, but we kept the same slot and did not flash the system image. Once those prerequisites were in place, module-based iteration made the driver work much easier.

It also forced us to test teardown properly. Early versions could capture frames yet leave workqueues or device-tree references behind on removal. We fixed those ownership paths and checked load, capture, stop, unload, and reload separately.

The main camera-control and sensor code stayed identical to the pinned upstream version. The userspace changes concentrated on buffer access, image stride handling, and the consumers of those frames.

## Verifying DMA-BUF frames

Our first GPU test used changing synthetic DMA-heap patterns. Tinygrad imported them through MSM DRM and produced the expected arithmetic results. That established the basic import path.

Real cameras added a timing constraint. The ring had 18 slots at 20 Hz, giving a frame about **0.9 seconds before its allocation could be reused**. The verifier’s first GPU/JIT setup took about **2.55 seconds**. By the time it compared the pixels, it was looking at a newer frame in the same buffer.

Our test was comparing different frames.

We warmed the verifier on dummy input, consumed the latest frames, and checked frame identity before and after access. The corrected test covered 120 changing frames per camera, every ring slot, and 8,192 sampled Y/UV bytes per frame, with exact CPU/GPU agreement.

The implementation also needed explicit CPU-access synchronization and reliable mapping lifetimes across msgq, openpilot, and tinygrad. Imported mappings had to outlive their users, and cleanup failures had to remain retryable. These are separate concerns from sharing a file descriptor, as the kernel’s [DMA-BUF documentation](https://docs.kernel.org/driver-api/dma-buf.html) describes.

A second memory bug appeared in the camera driver’s command buffers. Values written through an uncached mapping turned into zero after CPU cache pressure. A memory barrier did not help: dirty cached zeroing could later overwrite the write-combined mapping. Preparing the allocation through the DMA API before exposing that alias fixed the reproduction.

There was also a missing `__GFP_COMP` flag on larger allocations whose freeing path relied on compound-page metadata. A bounded allocation test exposed progressive memory loss before the correction and passed afterward.

## From 83 ms to 29 ms in the driving model

Once the trained driving model consumed live camera frames, it ran at a median **82.7 ms**. At 20 Hz, the frame interval is 50 ms.

Profiling found the expensive part on the CPU. Across 61 inferences, tinygrad performed 25,986 linear allocation lookups, spending **3.388 of 3.766 seconds** of submission preparation finding which allocation contained an address.

A sorted allocation index and binary search removed the repeated scan. The index was invalidated at the relevant allocation, import, and free boundaries so aliases retained their existing lifetime behavior.

With the same model artifact, median inference fell to **29.5 ms**, with a **31.6 ms p95** in the measured samples after warmup.

Full-stack testing revealed two more costs. The MSM wait path was spinning while the GPU worked. Using the kernel fence wait reduced the benchmark’s waiting CPU fraction from roughly **98% to 0.5%**, without materially changing GPU wait duration.

Lazy JIT linking consumed about **279 ms of CPU time** on the first live camera call. Preparing the selected captured programs during model construction moved that work before frame processing. We checked that preparation executed no inference, advanced no model history, and preserved outputs and state exactly. Driver monitoring needed the same treatment for its warp and model.

Normal modeld startup also imported car interfaces through a dependency used only by demo mode. Moving that import into the demo branch avoided the work during normal startup.

None of these changes required changing model priorities, CPU affinity, or the lag-alert threshold.

## Encoding and segment rollover

Openpilot’s encoder expected the downstream Qualcomm interface; mainline Venus used a different V4L2 interface. We adapted buffer queuing, codec controls, cropping, and drain/restart behavior while keeping full-resolution camera DMA-BUFs as inputs.

Encoding a short clip was relatively easy. Ending a segment and starting the next one exposed the harder problems.

One failure reached a Venus firmware assertion. We inspected the existing firmware in Ghidra and matched it to a device crash dump. An internal feedback queue was full when an end-of-stream record attempted another insertion. Logging-heavy experiments sometimes passed while quiet ones failed, so the apparent successes needed careful retesting.

Comparing the mainline-selected Venus 5.2 firmware with the stock AGNOS 5.0 firmware already on the device exposed another mismatch: the stock firmware required a larger output buffer than the driver advertised. The repair queried the firmware requirement and reported the final allocated size consistently, rather than keeping a guessed oversized buffer.

The working module combination used the existing stock firmware and valid coherent storage for the end-of-stream submission. No firmware binary was patched.

A later rollover failure had a more direct explanation. The driver could return a requeued capture buffer empty, with timestamp zero, while the encoder was stopped. That completion could survive into the next segment and trip openpilot’s timestamp assertion.

A focused test reproduced it by requeuing the drained buffer before `START`. The fix restricted the stopped-state empty-return path to the input queue and allowed capture buffers to follow normal firmware queuing across drain. The timestamp assertion stayed in place. The behavior was checked against the [V4L2 stateful encoder interface](https://docs.kernel.org/userspace-api/media/v4l/dev-encoder.html).

The original encoder binary then passed repeated segment changes with the corrected driver. The final integrated run crossed fifteen rollovers on every encoder stream.

## Bringing up the speaker and microphone

Audio started with a disabled DSP and no ALSA card. [greatgitsby’s mainline-sound work in vamOS PR 128](https://github.com/commaai/vamOS/pull/128) supplied the foundation for clocks, routing, and separate playback/capture frontends. We adapted it for the comma 3X and Linux 7.2, using firmware already installed on the device.

The first playback and capture commands both succeeded. The speaker was still silent.

We played 997 Hz and 1733 Hz tones and looked for them in microphone recordings, with a muted-speaker control. Neither appeared. A digital loopback also failed, narrowing the problem to the playback transport.

The routing selected the wrong data line. The shared description used SD1, while the comma 3X downstream source used **SD0**. Correcting it made both tones appear clearly in both microphone channels.

With `soundd`, playback was much quieter. Direct tests used S16_LE samples, while PortAudio selected S24_LE. At the same input level, S24_LE playback measured about **48 dB below S16_LE**, or roughly **1/256 of its amplitude**.

The firmware expected the 24 significant bits in the upper part of the sample container. Advertising S32_LE with 24 significant MSBs fixed the alignment. The tested formats then agreed in normalized amplitude within 0.22%.

Unmodified `soundd` and `micd` passed repeated start/stop tests, followed by normal startup and sleep/wake checks.

## Display cleanup and camera startup

Displaying camera frames required an explicit linear layout for the DMA-BUF import and a separate OpenGL external texture for each EGL image. Reusing a texture name already created for a 2D target caused `GL_INVALID_OPERATION`.

Repeated openpilot launches leaked graphics memory. The display service retained a shared DRM file, and the startup spinner was always terminated with SIGKILL. Its graphics cleanup never ran, leaving about **102 MiB per tested spinner** attached to the shared client.

Replacing SIGKILL with SIGINT released memory but crashed during graphics initialization. Closing the spinner’s stdin let it finish initialization and clean up normally. Three ordinary manager launch/stop cycles then returned to the same measured graphics-memory baseline.

The display could release a buffer before its page flip finished. Waiting for a generic vblank did not guarantee that the pending flip had completed. An asynchronous replacement also had to contend with events from other clients sharing the DRM file. The tested solution used checked blocking presentation and retained the current buffer if presentation failed.

Cold camera startup revealed another ordering issue. The first sensor-ID read could return zero, while later attempts worked. In the downstream source, clock pinmux setup preceded the sensor’s timed power sequence; our port selected it afterward. Moving CCI initialization before that sequence passed a cold test and the final integrated run. The result supports the ordering change, although we did not measure the electrical waveforms or establish repeated cold-boot reliability.

## Testing the complete stack

For integration, we used a Jungle to supply ignition and replay recorded CAN through the physical Panda path. The Jungle v1 kept its existing firmware; an archived matching host client handled its older protocol.

The final test started cold, without opening camera Preview or warming the models first. It ran a timestamp-paced route for almost sixteen minutes while the actual cameras continued filming the bench.

| Component    | Final result                                                                 |
| ------------ | ---------------------------------------------------------------------------- |
| Cameras      | Three real DMA-BUF streams at about 20 Hz; 18,962 observed frames each       |
| Models       | Driving and driver monitoring passed continuity checks after frame 32        |
| Encoding     | Four streams, sixteen segments each, fifteen rollovers each                  |
| Recordings   | 64 videos decoded; 75,879 frames matched recorded encoder indexes            |
| Audio and UI | Ran alongside the camera and model workload                                  |
| Lifecycle    | Camera stop/start, offroad transition, sleep/wake, and Preview checks passed |

There were no observed camera gaps or timestamp mismatches, process failures, or `modeldLagging` events. Recording reconciliation found no internal losses; final messages arriving at the logging shutdown boundary were accounted for separately.

Touch still occasionally gets stuck. We fixed a short-tap click-through and raylib’s initialization of cached coordinates, but later testing still caught Linux reporting a finger down after I had lifted it. That investigation is still open.

## On the road

On September 20, 2026 I drove the stack for real: 133 recorded segments, about 2 hours 13 minutes and 224 km in a Skoda Kodiaq Mk1, with stock ACC for longitudinal and openpilot doing lateral control only. It was engaged for 92% of the logged samples, and every disengagement was driver initiated, through cruise cancel, the pedals, or a steering override.

Reading the route’s logs afterwards with openpilot’s own `LogReader` and `CANParser`:

| Check                  | Result over the drive                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| Encoder streams        | 158,872 frames each on road, wide, cabin, and qcam, with no gaps            |
| Driving model          | 27.0 ms mean, 27.6 ms p95, 53.9 ms max, and no dropped frames               |
| Control loop at 100 Hz | 12 ms p99, 14.4 ms max, with no skipped cycle                               |
| Thermals               | within limits throughout, 68.8 °C CPU and 70.4 °C GPU maximum               |
| Faults                 | no camera malfunction, communication issue, CAN error, or controls mismatch |

The UI does swing between 60 and 30 fps on freedreno, visible but harmless while driving.
