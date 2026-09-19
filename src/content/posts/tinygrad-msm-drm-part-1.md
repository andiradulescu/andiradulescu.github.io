---
title: "Tinygrad on mainline Linux, Part I: the Claude implementation"
description: "The first MSM DRM backend, its buffer-lifetime experiments, and why passing small GPU tests did not make it a working openpilot runtime."
pubDatetime: 2026-09-19T09:47:22Z
tags:
  - tinygrad
  - linux
  - debugging
  - ai
draft: false
featured: false
---

I wanted openpilot to run on vamOS with a mainline Linux kernel. That meant getting its neural networks onto the Adreno 630 GPU through a different kernel driver. I started the tinygrad work with Claude Code in March 2026. By April, I had an upstream PR, a separate GPU backend, and a collection of changes intended to stop GPU faults. I still did not have a reliable implementation.

This is the first of three posts about that work. [Part II](/posts/tinygrad-msm-drm-part-2/) covers the Codex rewrite and the upstream rejection. [Part III](/posts/tinygrad-msm-drm-part-3/) covers the implementation now in my fork and the remaining upstream work.

The initial question was about Mesa. Tinygrad could already use Mesa's IR3 compiler to generate Adreno machine code. On March 8, I asked Claude how to run a model through Freedreno. The answer pointed to tinygrad's QCOM backend with IR3 enabled.

That answered the compiler question. It left the kernel interface unresolved.

On the downstream Qualcomm kernel used by AGNOS, tinygrad's QCOM runtime talked to KGSL through `/dev/kgsl-3d0`. On mainline Linux, the interface I needed was MSM DRM through a render node such as `/dev/dri/renderD128`. Compiling the same GPU instructions did not make the allocation and submission ioctls interchangeable.

The work therefore had two distinct pieces:

```text
Tensor operations → tinygrad → Mesa IR3 → Adreno machine code
                                             ↓
                               buffers and command submission
                                             ↓
                                    MSM DRM → Adreno 630
```

On March 26, the [first implementation commit](https://github.com/andiradulescu/tinygrad/commit/49aea022fc3827109f5479448726686ec6ed816e) added a 373-line `ops_msm.py`, an MSM UAPI header, and binding-generation configuration. The new runtime owned allocation, program setup, command construction, submission, and synchronization. It was a separate backend, selected with `DEV=MSM`.

For this interface, an allocation had several identities. The kernel gave it a GEM handle. The CPU accessed it through an `mmap` address. The GPU accessed it through an I/O virtual address, or IOVA. Keeping those three associated correctly was essential. A GPU address was something to put in a command buffer, not a pointer Python could necessarily write through.

Small tests made progress. My March 26 conversation history includes a report that 16 of 17 non-skipped tests passed, followed immediately by the problem that compiling the openpilot models did not work. That was already a warning about the test coverage. A tensor addition exercises very little of the buffer reuse, graph replay, and resource lifetime involved in compiling and running a model.

The commit history shows how quickly the attempted fixes accumulated. We synchronized before copying inputs, invalidated caches at the beginning of the command stream, corrected a buffer-size mismatch, and synchronized after every submission to keep temporary buffers alive. We disabled the allocation cache, enabled it again with more cache operations, then disabled it again.

Those commits record what we were trying. Their messages do not establish that each proposed explanation was correct.

One recurring idea was to avoid closing GEM handles while the process was running. If the failure appeared when an allocation was freed, retaining that allocation could make the immediate symptom disappear. On March 27, I explicitly asked for a buffer pool that retained handles. The implementation then returned to asynchronous submission and added a graph path to batch JIT kernels into a single DRM submission.

That created another obligation: a captured graph had to follow new input allocations. The first graph implementation rebuilt commands and arguments on each call. A later change prebuilt them and patched input IOVAs. Replaying a graph was no longer just resubmitting the bytes from its first execution.

The allocation policy kept changing. March 28 commits restored actual freeing and added proactive address-space reclamation. The [March 29 version](https://github.com/andiradulescu/tinygrad/commit/2a93a8b3a1e57b6d770670d881ceeb7f0614e879) removed that reclamation and made the allocator's `_free` method do nothing. Its rationale was that a large virtual address space allowed handles to survive until process exit.

That was a workaround with an obvious limit. Virtual address space does not make physical memory or kernel allocation objects free. Retaining resources may be useful in a diagnostic experiment, but it cannot establish that ordinary allocation and cleanup are correct. The implementation had reached a point where lifetime problems were being managed by changing how long everything lived.

Meanwhile, the UI could lock up during model compilation or replay. The March conversations record repeated `Failed to page flip` reports, including cases where I did not see a GPU fault in the log I was watching. A later tinygrad commit lowered submission priority and split graph submissions into chunks to give display work room to run. There was also separate investigation of the raylib display path.

I cannot reduce all of those lockups to one cause. Camera work was happening on the same device, some restarts came from another development session, and some faults were visible on serial rather than in the log being inspected. What the record does establish is that completing a compute test did not establish reliable coexistence with the UI.

In April, I asked Claude to prepare a cleaner upstream submission. That became [tinygrad PR #15656](https://github.com/tinygrad/tinygrad/pull/15656), opened on April 8. It extracted shared A6xx helpers into `support/adreno.py`, but retained separate QCOM and MSM runtimes.

The rewrite also exposed the CPU/GPU address distinction directly. A shared helper wrote the workgroup size into the argument buffer using its GPU address. The [April correction](https://github.com/andiradulescu/tinygrad/commit/f9f7515c2ee5aded7872d7d3d72129653a87487b) added a separate CPU address for that write, while preserving the GPU address in the commands. Another change reused per-program argument and command buffers and synchronized every dispatch.

These were real corrections. They did not close the whole problem. The April history still contains output-mismatch investigation, and a later fault report names `compile3.py` compiling `driving_vision.onnx` as the offending process during repeated GPU hangcheck recovery.

Calling this first attempt “not working” needs that context. There were successful small tests and useful pieces of code. There were also model failures, lockups, and unresolved lifetime behavior. It had not become a runtime I could rely on for the intended workload.

When geohot closed the upstream PR on July 26, the feedback was concise:

> We want this, but it has to be cleaner and reuse the existing driver

That [comment](https://github.com/tinygrad/tinygrad/pull/15656#issuecomment-5084071968) changed the direction of the work. Sharing a few helper functions still left two runtimes to maintain. The next attempt would keep tinygrad's existing QCOM program and command machinery, and put the difference at the kernel interface.

Claude had helped me produce a prototype and investigate a substantial amount of hardware behavior. I had also accepted too many plausible explanations as reasons to add another change. The rewrite needed a smaller architectural boundary and tests that could tell us which part was actually wrong.

That is where [the Codex attempt begins](/posts/tinygrad-msm-drm-part-2/).
