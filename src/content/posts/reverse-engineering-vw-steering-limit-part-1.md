---
title: "Reverse engineering a VW steering limit, Part I"
description: "Two failed attempts to increase openpilot steering torque, and the firmware analysis that traced the VW EPS rejection to internal model checks."
pubDatetime: 2026-07-30T12:00:00Z
tags:
  - openpilot
  - reverse-engineering
  - hardware
  - debugging
draft: false
featured: false
---

I wanted openpilot to apply a little more steering torque before I had to intervene. The electric power steering controller, or EPS, appeared to reject requests above 300 cNm, equivalent to 3 Nm. I started looking for that limit in its firmware.

Between April and July 2026, I tried changing the calibration data and then a comparison instruction. Neither approach worked. The car still rejected higher requests.

I worked on this with Claude and Codex, using Ghidra to examine the firmware and comparing the results with logs from the car. We found several values that looked like the limit. We also made mistakes about what those values meant, sometimes treating an assumption as something we had proved.

## The fault

The EPS used firmware from the `5Q0909143` family. Most of this work concerned software version 2051. We also had a flash dump from version 2041.

With openpilot configured to request more than 300 cNm, the command would briefly pass that value before openpilot's steering assistance stopped. One recorded ramp was:

```text
286, 290, 294, 298, 302, 306, 310 cNm
then an EPS rejection and a zero steering request from openpilot
```

Openpilot sent these requests through the EPS's HCA steering interface over CAN, the car's data bus. The values showed how much torque openpilot requested; they did not measure how much the motor delivered.

The interruption lasted about two seconds. Later logs showed the EPS changing from HCA status 5, active, to status 4, rejected. A diagnostic scan could still show no stored trouble code.

The peaks around 310–313 cNm initially seemed consistent with a 300 cNm limit and a short delay before the fault appeared. We still needed to find what the EPS was comparing.

## Changing the calibration data

The first attempts to read memory through the controller's diagnostic services had failed. We turned to firmware and parameter files that we could examine offline.

By May, we had found `0x012C`, decimal 300, at offset `0x3E8` in dataset record `0x71`. There was a matching value in the extracted firmware. A function we had named `CheckTorqueCalLimits` read a signed 16-bit value at offset `0x12C` from a calibration pointer.

We thought that function read the 300 we had found. I changed the dataset value to 500, recalculated its checksum, and flashed it.

On May 5, the result was unchanged: requests peaked around 313 cNm, there were no frames at or above 320 cNm, and the temporary fault remained.

We considered a failed write, calibration that had not reloaded after a reset, and the possibility that the function read a different copy. The reset theory had a problem: a diagnostic trace already showed an ECU-reset request and a positive response. We had overlooked it.

I then tried changing the corresponding value in the application firmware. On June 17, I flashed a modified FRF firmware package for version 2051. Requests above 300 cNm still caused a rejection.

There was another problem too. Turning the wheel against openpilot could now trigger faults at lower commands. The June analysis linked those incidents to changes in openpilot's driver-torque limiting when its maximum torque was raised. Since both the sender configuration and EPS firmware had changed, I couldn't assume the firmware edit caused every new symptom.

## We had followed the wrong calibration pointer

We had matched bytes across the firmware, parameter records, and flash dump. But we had not proved that the running function read those bytes.

The July analysis traced the SW2051 pointer elsewhere:

```text
pointer stored at 0x40001270
    → SRAM address 0x4000450C
    → data from selector 0x70
```

At that location, `pointer + 0x12C` contained **1**, not 300. The function checked steering-response plausibility and counted failures. We had named it `CheckTorqueCalLimits` before we understood it.

The repeated `0x12C` had helped lead us astray. It is decimal 300, but in the load instruction it was a byte offset. Adding it to the flash base we had assumed happened to reach another `0x012C`.

The value I had changed was part of a calibration curve. It was the first output value in this sequence:

```text
300, 800, 1800, 3500, 8300, 15300
```

We had changed the start of a curve without establishing what used it. Its exact effect remained unknown.

We also corrected our understanding of the stored copies. `FD_3DATA` was a slice of `FD_0DATA`. The two nonvolatile copies of record `0x71` were A/B storage mirrors. We had been counting matching values without knowing which copy the code read.

## Changing a comparison instruction

In July, tracing the rejection code led to an instruction that really did compare a value against 300. In SW2051, it was at application-file offset `0x42D8C`, or full-flash address `0x4ED8C`.

Ghidra and the PowerPC VLE assembler agreed on the instruction. Changing its constant to 500 kept the same instruction size, register, and branches.

We checked the rebuilt file before flashing. The decoded application differed by one byte. Its checksum changed separately in the ODX file, which holds the firmware blocks and programming information inside the FRF package. The other decoded blocks and programming order were unchanged. Reverting the byte and checksum reproduced the original ODX content. Repacking changed many more bytes in the compressed, encrypted FRF.

On July 14, I flashed the new image. The car behaved the same again.

We continued assuming the flash had succeeded. We could verify the file we built, but we did not have a readback from the controller to confirm what was running.

Further analysis found another mistake. The instruction compared a **model residual**, an internal error signal that checks how well the steering response agrees with a reference model. We had treated that signal as the requested torque.

The constant in the file had changed from 300 to 500. We had no basis for calling those values 3 Nm and 5 Nm.

## What the firmware was checking

The code calculated two residuals. The first began with a difference between a model observation and a filtered reference:

```text
model difference = model observation − filtered reference
```

Vehicle speed and driver input affected how that difference was weighted. The result fed a related residual. A second, primary residual combined it with another model value and further scaling and bounds.

We could follow the arithmetic, but we had no conversion from these internal counts to cNm.

The checks ran in a particular order. An earlier check could reject when the related residual had the same sign as the model difference, its magnitude reached 227, and a bypass flag was clear. The comparison I had changed from 300 to 500 came later and used the primary residual.

The earlier check could therefore still reject a request after the edit. It became our leading explanation, although the logs did not show which internal check had fired.

The protection code counted three failing samples in a task running every 4.8 ms before setting the rejection state. Openpilot then saw a temporary steering fault, disabled lateral control, and sent an inactive HCA request with zero torque.

That gave us a reason for the request dropping to zero without a simple clamp holding it at 300 cNm. The code could also set state 4 without calling the normal diagnostic-event reporter, which was consistent with the absence of a stored trouble code.

## Getting Ghidra to decompile the code

To read the firmware in Ghidra, we needed the correct PowerPC VLE instruction mode, base registers, and address mapping. For the later analysis, we reconstructed a full-flash image with the 2051 application from the files we had. It was not a readback from my EPS after flashing.

One task, scheduled every 1.2 ms, would not finish decompiling. Codex recovered six computed switches and fixed switch handling and control-flow reconstruction in a separate decompiler build. A clean run produced a C-like decompilation in about seven and a half minutes. This gave us a readable view of the fast task, including how steering-sensor inputs reached the reference model.

By the end of July, Codex had also built an emulator for selected protection and command-processing routines. We compared two of those routines with execution of the firmware instructions in 101 test cases: the residual classifier and a routine that scales and limits a command value. The emulator let us test the logic with supplied internal values, but could not predict delivered steering torque.

## The diagnostic samples missed the fault

On July 24, I collected a trace using ODIS, VW's diagnostic software, alongside logs from the comma device. The analysis found 12 state-4 incidents and 35 active requests above 300 cNm. Every one of those requests had a byte-identical transmit echo from Panda, openpilot's CAN interface. The peaks were still around 306–312 cNm.

Panda was transmitting the larger requests. It was not simply blocking them at 300.

ODIS was reading 257 fields in a loop, so it returned to each field only about once every 1.65 seconds. The rejection began within a window of roughly 37–48 ms.

Data identifier (DID) `0x1823` exposed the upstream residual signals we wanted to see. All 307 samples were zero, but none fell inside a decisive rejection-onset window. We had sampled too slowly to know whether the residuals briefly crossed their thresholds.

DID `0x1110` could expose an internal event history. All 307 reads failed because the required diagnostic mode was not active. That left us without the event codes that could have distinguished the checks.

By July 29, the combined analysis had found 47 above-300 requests with exact transmit echoes and 16 rejection episodes, all accompanied by temporary faults. The sequence was:

```text
request above 300 cNm
    → transmitted CAN command
    → EPS rejection
    → temporary steering fault
    → openpilot disables lateral control and sends zero
```

I had not successfully increased the steering torque. We had traced how the EPS rejection caused openpilot to disable lateral control and send zero, but had not observed which internal residual check fired in the car. Neither the calibration edits nor the instruction edit had achieved the original goal.
