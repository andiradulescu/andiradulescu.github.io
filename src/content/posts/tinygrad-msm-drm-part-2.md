---
title: "Tinygrad on mainline Linux, Part II: the rejected Codex rewrite"
description: "Reusing QCOM, fixing an instruction-size mismatch, and discovering why green checks and device runs were not enough for an upstream contribution."
pubDatetime: 2026-07-30T09:00:00Z
tags:
  - tinygrad
  - linux
  - debugging
  - ai
draft: false
featured: false
---

The second attempt started with a clear instruction from upstream: reuse the existing driver. The [first implementation](/posts/tinygrad-msm-drm-part-1/) had a separate MSM runtime, shared helpers, and unresolved failures on the device. On July 26, I asked Codex to start again from current tinygrad master on a separate branch.

This time, the architecture followed the existing QCOM runtime. The program representation, argument packing, Adreno command encoding, queues, and allocator policy would stay shared. KGSL and MSM would supply the operations that actually differed at the kernel boundary.

```text
                     QCOM runtime
                programs, arguments, PM4
                          │
                 kernel interface
                    ┌─────┴─────┐
                 KGSLIface   MSMIface
                    │           │
              /dev/kgsl-3d0   DRM render node
```

There was a concrete prerequisite. The old QCOM path could use the same numerical address for CPU and GPU access in places where MSM could not. Tinygrad's existing HCQ buffer abstraction already exposed a CPU view separately from the GPU address. Codex added focused failures for argument writes and uploads, then changed those writes to use the CPU view. GPU commands continued to contain GPU addresses.

The new MSM bindings came from the pinned Linux UAPI headers used by tinygrad's generation machinery. The local work included a compiled C check of structure sizes and ioctl values. That mattered because a Python object with the right field names can still have the wrong ABI layout.

By the first hardware handoff, the implementation had host tests, lint and type checks, reproducible bindings, and mocked allocation-lifecycle coverage. Those checks were useful. The first real openpilot startup immediately found things they had not exercised.

`compile_warp.py` passed memory through `Tensor.from_blob`, while the new MSM interface explicitly rejected external pointers. A graph submission also included a buffer that the interface did not recognize as one of its allocations. The latter involved resolving buffers through the captured graph. Fixing it allowed driver monitoring to compile, capture, replay, and produce its serialized artifact.

The external-memory problem was more involved. A raw CPU pointer does not identify a GEM object to the MSM kernel driver. The July implementation grew a DMA-BUF import path to support the surrounding openpilot work. That brought mapping offsets, repeated imports, ownership, and cleanup into the same contribution.

Every part had a reason to exist in the development branch. Together they made the upstream change harder to evaluate. A reviewer now had to assess a kernel-interface refactor, new bindings, allocation and submission behavior, graph replay, external-memory import, and shared QCOM fixes.

One of those shared fixes became a separate investigation. The QCOM command stream programmed `SP_CS_INSTR_SIZE` using `image_size // 4`. That converted shader bytes into 32-bit words. Mesa's IR3 compiler exposed an instruction-length value in a different unit.

The mainline model runs had translation faults and hangcheck recovery. Codex initially explained the correction too confidently in terms of dividing the allocation size by 128. Further review exposed another distinction: the compiler's logical instruction count need not equal a padded binary size converted into groups. The implementation needed to retain the compiler metadata instead of reconstructing it from an allocation size.

I opened [PR #17224](https://github.com/tinygrad/tinygrad/pull/17224) for the rewrite on July 26. Its description reported successful openpilot model runs in my development branches and testing on MSM and KGSL devices. I then split out [#17242](https://github.com/tinygrad/tinygrad/pull/17242), the instruction-length correction, and [#17244](https://github.com/tinygrad/tinygrad/pull/17244), the KGSL interface extraction.

This is the stage I describe as the “AI slop” rejection. The public review is more specific than that shorthand, and deserves to be represented accurately.

On the instruction-length PR, sirhcm asked for a reproducer and challenged both whether the tests ran in CI and whether they proved the reported failure. On the interface extraction, the concerns were the size of the change, its apparent AI generation, and the lack of relevant CI coverage. The verdict was that it was not close to mergeable. Those are separate [comments on #17242](https://github.com/tinygrad/tinygrad/pull/17242#issuecomment-5098060071) and [#17244](https://github.com/tinygrad/tinygrad/pull/17244#issuecomment-5098111789), rather than a literal “AI slop” comment on #17224.

The distinction matters because the feedback was actionable. The interface direction had been encouraged. The submitted implementation and its evidence still had to earn acceptance.

I asked Codex to trace how we had missed the CI problem. The resulting audit found that the QCOM jobs we had relied on were compile-only. They did not run the live allocation, submission, waiting, and cleanup paths affected by the refactor. The standalone interface PR added no tests. The instruction-length tests had been placed where the relevant CI jobs did not collect them.

That made three different statements look deceptively similar:

| Statement                            | What it established                  |
| ------------------------------------ | ------------------------------------ |
| A test existed                       | There was test code in the branch.   |
| The workflows were green             | The jobs that ran had passed.        |
| The new runtime behavior was covered | This still needed separate evidence. |

A test that inspects a value assembled from its own assumptions also has a weaker claim than one that exposes a wrong result or compares with an independent implementation. We needed to demonstrate why the value was wrong, then show what the correction changed.

For the instruction-length issue, the next experiment was more useful. On a real KGSL device, a small IR3 kernel produced the correct arithmetic result on both base and changed code. The base emitted `64` for a shader whose compiler metadata said `2`; the changed version emitted `2`. A separate capture from Qualcomm's OpenCL runtime supplied another comparison of the programmed register and shader-load units.

This demonstrated a command-stream mismatch. It did **not** reproduce a KGSL crash. That limit was recorded in the [follow-up evidence](https://github.com/tinygrad/tinygrad/pull/17242), instead of turning a mainline fault into an unsupported claim about every QCOM configuration.

The instruction-size issue did get addressed upstream. On July 29, sirhcm closed my PR in favor of [#17289, “qcom: match cl for SP_CS_INSTR_SIZE”](https://github.com/tinygrad/tinygrad/pull/17289), which was merged. The upstream version compared tinygrad's commands with Freedreno and Qualcomm OpenCL behavior. My larger MSM contribution remained closed.

That outcome belongs in the story alongside the rejection. There was a real technical discrepancy, and an upstream fix landed. It did not follow that the surrounding refactor, DMA-BUF work, and new interface were ready as a package.

Codex had also called a fork revision “merge-ready” during the July work. Looking back through the conversation, that label was ahead of the evidence. Local tests, device runs, resolved comments on my fork, and green workflows did not establish that upstream's review concerns had been answered.

Splitting the work into smaller PRs had not solved that by itself. An interface extraction still asked maintainers to accept changes across existing KGSL behavior before seeing the MSM implementation that needed them. A small line count could also conceal an untested contract. The relevant question was what each diff changed and how a reviewer could verify it.

I continued in my fork. The next phase included more failed hardware tests, a substantial upstream runtime change, and two bugs that could be reproduced independently of MSM. Those became the basis of [the current PR stack](/posts/tinygrad-msm-drm-part-3/).
