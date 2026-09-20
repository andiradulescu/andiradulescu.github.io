---
title: "Tinygrad on mainline Linux, Part III: the draft PRs"
description: "Porting MSM to HCQ2, fixing JIT views and GPU timestamps, and preparing a narrower Adreno 630 implementation for upstream review."
pubDatetime: 2026-09-13T09:00:00Z
modDatetime: 2026-09-19T18:45:00Z
tags:
  - tinygrad
  - linux
  - debugging
  - ai
draft: false
featured: false
---

As of September 13, 2026, the current MSM DRM implementation is in [draft PRs on my tinygrad fork](https://github.com/andiradulescu/tinygrad/pulls). It uses the shared QCOM runtime, has recorded execution on an Adreno 630 through both mainline MSM DRM and downstream KGSL, and still needs to be submitted upstream.

Getting from [the rejected July rewrite](/posts/tinygrad-msm-drm-part-2/) to this version involved more than reducing its diff. Hardware testing found additional failures, upstream replaced the queue machinery underneath the branch, and review found bugs that belonged outside the MSM implementation.

An August test illustrates how little successful initialization establishes. At the frozen `287723cdd` revision of fork PR #15, device discovery worked. Tinygrad identified the Adreno 630 and selected MSM with IR3. The first actual submission failed at `DRM_IOCTL_MSM_GEM_SUBMIT`:

```text
BlockingIOError: [Errno 114] Operation already in progress
```

The fault counter stayed at zero and the kernel log did not change. The operation had still failed. No JIT or model result could be inferred from that run.

The investigation pointed to the interaction between `MSM_BO_NO_SHARE` allocations and the kernel's reservation locking. Later versions used write-combined GEM objects and explicit submission buffer lists. Another simplified version omitted buffers referenced by GPU commands and produced a translation fault. Reducing the list was only valid if the kernel still received every allocation the GPU could access.

There was also an older HCQ graph hang in September. The surviving record reported an increase in GPU faults and a process blocked during fence teardown. Its root cause was not established. I am keeping that failure separate from the later implementation, because upstream changed the runtime before the next round of work.

Tinygrad moved QCOM to HCQ2 and replaced `HCQBuffer` with the newer `Buffer` and `BufferStorage` ownership model. The MSM branch had to be ported. Carrying the old patch forward mechanically would have preserved assumptions about queues, captured graphs, and memory ownership that no longer matched master.

The current submission path follows the addresses used to build the command stream. At execution, it resolves those references to live MSM allocations, constructs a deduplicated buffer-object list, and submits the command buffer with its offset and size. A replay with a different input allocation must update both the GPU address in the commands and the kernel's list of referenced allocations.

The [implementation at `c747d96b6`](https://github.com/andiradulescu/tinygrad/blob/c747d96b652f079d797bcfdc0c6a27b0c396e96e/tinygrad/runtime/ops_qcom.py) derives those two uses from the same `GETADDR` references. That makes the relationship visible in the code instead of maintaining unrelated lists that can disagree.

The ioctl runs through a ctypes callback used by the compiled submission path. Python exceptions cannot simply propagate through that boundary. The callback retains a submission error, and the interface raises it on the next wait. During review, Claude Code removed an earlier implementation that added error-checking hooks to tinygrad's core runtime. The final version keeps this handling inside the QCOM interface path.

Testing the port uncovered a failure above the kernel interface. A realized contiguous view could remain an alias of another tensor's storage. TinyJit captured the wrong representation of that input, so alternating between two input allocations could replay with stale data.

This reproduced on CPU. It did not require an Adreno, a DRM node, or a GPU fault. The test alternated two different allocations, applied a simple arithmetic expression, and checked every result across capture and replay. Before the fix, all four offset/reshape cases failed, with every output element wrong.

[PR #17](https://github.com/andiradulescu/tinygrad/pull/17) captures the underlying storage while retaining the surrounding movement operations. Its current diff changes a few lines in JIT input preparation and adds the regression test. This is useful as an independent tinygrad fix, even if MSM support takes longer to review.

That test found another problem when it reached x86 CI. The LLVM renderer promised 32-byte alignment for global pointer arguments. A view beginning one float into an allocation supplied a pointer four bytes past the aligned base. On the tested x86 path, the resulting aligned loads could segfault even in eager execution.

The view-capture test now uses offsets compatible with that alignment promise. [PR #21](https://github.com/andiradulescu/tinygrad/pull/21) separately records the alignment mismatch with an expected-failure test that does not crash the worker. It tracks the bug; it does not fix LLVM alignment. Keeping those claims separate lets the JIT test exercise its intended regression without quietly discarding the other finding.

Profiling then exposed a smaller bug. The numerical results were correct, but the recorded GPU durations were all zero. HCQ2's signal slot stores its timestamp eight bytes after the signal value. QCOM was writing the hardware counter to the beginning of the slot.

The [runtime change in PR #18](https://github.com/andiradulescu/tinygrad/commit/5d6c26dd35ef394fd507fa18910844acb6d25080) adds `+ 8` to the destination address. Its test runs a JIT workload under profiling, synchronizes while profiling is still active, and checks that the collected timestamps are nonzero and ordered. In the preserved September 10 experiment, the original reproducer went from five zero durations to approximately 44–45 microseconds per measured event after the correction.

The main MSM contribution is now [PR #20](https://github.com/andiradulescu/tinygrad/pull/20). It contains three commits: extract the existing KGSL kernel operations, generate the MSM UAPI bindings, and add `MSMIface`. Programs, command encoding, the allocator, and the QCOM device remain shared. Support is deliberately limited to Adreno 630 and the IR3 renderer.

There was briefly a standalone interface-extraction PR, #19. It was closed and folded into #20 so the refactor and the implementation requiring it could be reviewed together. That directly addresses a weakness of the July split: a reviewer can now see why the interface exists in the same diff.

The generated bindings account for 904 added lines. They are important ABI material, but they are different review work from the handwritten runtime. The remaining changes include mocked tests of struct layouts, ioctl numbers, command descriptors, buffer lists, replacement inputs, offset views, and error propagation. Those tests run in the Null Tests job. They check submission construction without pretending to execute an MSM GPU.

A separate host-mapping gap became [PR #22](https://github.com/andiradulescu/tinygrad/pull/22). The QCOM allocator lacked `_map`, even though the KGSL interface already had a user-memory mapping path. Adding `_map` and `_unmap` made the existing host-buffer test pass on KGSL. MSM continues to reject external pointer mapping explicitly. A raw host pointer and an importable DMA-BUF are different interfaces, and this PR does not add DMA-BUF import to MSM.

The current review stack is:

| Fork PR                                                  | Purpose                                     | Head revision |
| -------------------------------------------------------- | ------------------------------------------- | ------------- |
| [#17](https://github.com/andiradulescu/tinygrad/pull/17) | Capture realized contiguous JIT input views | `14e5bd966`   |
| [#18](https://github.com/andiradulescu/tinygrad/pull/18) | Correct HCQ2 profiling timestamps           | `5d6c26dd3`   |
| [#20](https://github.com/andiradulescu/tinygrad/pull/20) | Add MSM DRM through the QCOM interface      | `c747d96b6`   |
| [#21](https://github.com/andiradulescu/tinygrad/pull/21) | Track the LLVM view-alignment bug           | `cc791ad4a`   |
| [#22](https://github.com/andiradulescu/tinygrad/pull/22) | Implement QCOM host-buffer mapping          | `d0ded260e`   |

The branch chain is `#17 → #18 → #20 → #22`; #21 is based directly on master. The small fixes can be prepared independently for upstream review. Their current stacking is a way to test the combined implementation, not a requirement that upstream accept them as one change.

The September 11–12 hardware records cover an Adreno 630 on mainline Linux 7.2 through MSM, and an AGNOS 19.6 device through KGSL with both QCOMCL and IR3. The replay harness alternated replacement buffers and 17-element offset views, checked exact results, and confirmed that HCQ replay actually occurred. The MSM runs recorded 800 replays in the normal check and repeated the check under profiling, with the fault counter remaining zero. KGSL ran the corresponding replay checks on both renderers.

There are limits to those results. The main MSM PR still has the known host-pointer mapping limitation. Before the mapping follow-up, the existing HCQ2 map test also failed on KGSL and on unmodified master. `test_ops` was not run on the devices because PyTorch was unavailable there. Successful fork CI does not supply a permanent upstream MSM hardware runner.

Even a clean rebase needed scrutiny. On September 12, upstream had replaced `Ops.CONTIGUOUS` with `Ops.COPY`. The stack applied without textual conflicts, but the JIT fix still referenced the old operation. The CPU reproducer failed on the new base, the fix was adapted, and the host and device checks were repeated. The current fork heads include that adaptation, based on master `19e8a3ccf`.

The work also continues in the downstream openpilot integration. That branch includes DMA-BUF camera access and later performance changes described in [the camera bring-up post](/posts/openpilot-cameras-mainline-linux/). Those results belong to that integration branch. They do not turn the narrower MSM fork PR into a claim of complete camera support or driving readiness.

The next upstream submission should make each of these boundaries easy to inspect: a reproducible JIT bug, a timestamp fix with an observable failure, a separately tracked alignment problem, a small KGSL mapping correction, and an MSM interface with a stated hardware scope. The branches will need to be checked against the master revision used for submission, rather than relying on September's results after further upstream changes.

This version was still built with AI assistance. Codex wrote the implementation and initial regressions; Claude Code reviewed the stack, simplified the runtime integration, and added follow-up work. The improvement is visible in what remains: fewer responsibilities in the MSM diff, failures preserved alongside successes, and tests that a reviewer can connect to a specific claim.

The implementation now has a clearer case for upstream review. Acceptance remains the next step.
