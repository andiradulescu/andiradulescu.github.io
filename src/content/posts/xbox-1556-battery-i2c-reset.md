---
title: "Fixing an Xbox One rechargeable battery with a Pico 2 W and I²C"
description: "Diagnosing and resetting an Xbox model 1556 battery charger over I²C, with a verified pinout and before-and-after register readings."
pubDatetime: 2026-09-18T21:50:51Z
tags:
  - hardware
  - debugging
  - raspberry-pi
draft: false
featured: false
---

My Xbox One rechargeable battery pack, model 1556, could still power a controller, but charging was not working properly. Using a Raspberry Pi Pico 2 W as a USB-to-I²C interface, I read its charger registers and found an unexpected charge-voltage setting: **3.50 V instead of the documented 4.20 V default**.

Resetting the charger registers restored that setting to 4.20 V. Afterward, the pack charged normally again.

This is a record of one successfully repaired pack, not a claim that every charging problem with this model has the same cause. I did not establish why the setting had changed, or measure capacity before and after the repair.

## The hardware

The pack uses a Texas Instruments **BQ24250** charger, accessible at the 7-bit I²C address **`0x6a`**. A Pico 2 W running MicroPython provides the I²C master; the Mac controls it over USB using `mpremote`.

I used:

- An Xbox One model 1556 rechargeable battery pack.
- A Raspberry Pi Pico 2 W with MicroPython installed.
- A Mac, a USB cable, and `mpremote`.
- A multimeter, a 1 kΩ resistor, and two 330 Ω resistors.

The pack's charger input remained disconnected throughout the register reads and reset. The pack supplied its own internal circuitry.

## The crucial detail: the contact order

The physical contact mapping was the hardest part of this investigation. We initially reversed the four small contacts, which led to several misleading tests.

On the pack tested here, moving **from the large AA+ contact toward the large AA− contact**, the order is:

```text
AA+ | PNC | SDA | SCL | +5 V charger input | AA−
```

**PNC is the small contact closest to AA+.** The +5 V charger input is the small contact closest to AA−.

The schematic's connector numbers run in the opposite direction:

| Small contact, starting nearest AA+ | Signal             | Schematic pin |
| ----------------------------------- | ------------------ | ------------- |
| First                               | PNC                | J1.4          |
| Second                              | SDA                | J1.3          |
| Third                               | SCL                | J1.2          |
| Fourth                              | +5 V charger input | J1.1          |

These are pins of connector **J1**, not four separate connectors named J1 through J4. The drawing's connector numbering alone should not be used to infer a left-to-right view of the physical pack.

## Enabling the pack without a controller

Loose on the bench, the pack initially showed 0 V on AA+, SDA, and SCL. Yet it could power an Xbox controller with the controller's USB cable disconnected.

The explanation was the pack's output-enable circuit. In the reverse-engineered schematic, PNC connects through R633, 25.7 kΩ, to the base of the PNP transistor Q2. R632, 100 kΩ, connects the base toward the emitter supply. Pulling PNC low turns on Q2, which drives the output regulator's control input.

The actual PNC contact measured approximately **3.395 V relative to AA−** with nothing connected. Connecting it to AA− through **1 kΩ** enabled the pack:

```text
PNC ── 1 kΩ ── AA−
```

With that resistor attached, I measured approximately **2.8 V on AA+, SDA, and SCL**. The schematic shows the SDA/SCL pull-ups connected to the switched AA+ rail, explaining why all three appeared together.

The extra 1 kΩ resistor was a precaution for probing the connector. It is not a voltage converter. No external voltage was needed on PNC.

Earlier attempts to pull the misidentified contact high did not enable the output. The successful test established both the physical mapping and the active-low behavior on this pack.

## Connecting the Pico

I kept the PNC-to-AA− resistor connected and wired the I²C bus as follows:

| Pico 2 W physical pin | Connection    | Battery pack |
| --------------------- | ------------- | ------------ |
| 8: GND                | Direct wire   | AA−          |
| 6: GP4 / SDA          | Through 330 Ω | SDA          |
| 7: GP5 / SCL          | Through 330 Ω | SCL          |

The 330 Ω resistors provide some fault-current limiting; they do not translate voltage. The measured 2.8 V bus level was suitable for the Pico.

With the Pico's components facing you and its USB connector at the top, pins 6, 7, and 8 are the sixth, seventh, and eighth contacts down the left edge.

**AA+ and the pack's +5 V charger input were left disconnected from the Pico.** Neither Pico 3V3 nor USB VBUS was connected to the pack. I powered the Pico over USB before connecting the signal wires and used AA− as the common ground.

Avoid bridging adjacent contacts with probes. Do not bypass the pack's protection circuitry or attempt this on a damaged or swollen pack.

## Talking to the pack from macOS

With MicroPython installed on the Pico 2 W, I installed the host tool using:

```bash
uv tool install mpremote
```

The Pico appeared on this Mac as `/dev/cu.usbmodem1401`. That name can differ on another machine; the commands below use `connect auto` and assume only one MicroPython device is attached.

An initial scan was enough to verify the connection:

```bash
mpremote connect auto exec \
'from machine import I2C,Pin; i=I2C(0,sda=Pin(4),scl=Pin(5),freq=100000); print([hex(a) for a in i.scan()])'
```

Result:

```text
['0x6a']
```

During setup, we repeated the scan once per second and stopped when `0x6a` acknowledged. The scan did not write charger configuration values.

## Reading the charger registers

The BQ24250 exposes seven registers at addresses `0x00` through `0x06`. This command reads them individually:

```bash
mpremote connect auto exec '
from machine import I2C, Pin
i = I2C(0, sda=Pin(4), scl=Pin(5), freq=100000)
for reg in range(7):
    value = i.readfrom_mem(0x6a, reg, 1)[0]
    print("0x%02X: 0x%02X" % (reg, value))
'
```

The stable pre-reset register dump was:

```text
Address: 00 01 02 03 04 05 06
Value:   3A EC 00 F8 02 A8 E0
```

Three follow-up snapshots returned identical values.

| Address | Value  | Interpretation                                                                                                                                                                                                  |
| ------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x00`  | `0x3A` | Charger fault status: input fault and LDO low. Watchdog disabled, no watchdog fault reported.                                                                                                                   |
| `0x01`  | `0xEC` | External input-current limit selected; charge permission and termination enabled; high-impedance mode off. Bit 7 is a reset command on writes, not a persistent configuration flag to interpret from this read. |
| `0x02`  | `0x00` | **Charge-voltage target decodes to 3.50 V.**                                                                                                                                                                    |
| `0x03`  | `0xF8` | External ISET charge-current selection. In external-current mode, termination is normally 10% of the selected charge current.                                                                                   |
| `0x04`  | `0x02` | No limiting-loop event reported; input-voltage regulation threshold 4.36 V.                                                                                                                                     |
| `0x05`  | `0xA8` | SYSOFF disabled; temperature monitoring enabled with no temperature fault reported; 6-hour safety timer and timer extension enabled.                                                                            |
| `0x06`  | `0xE0` | Input overvoltage threshold 10.5 V; production-test mode and forced battery detection off.                                                                                                                      |

The first status read was `0x33`, indicating sleep. Later reads returned `0x3A`. The datasheet documents latched fault reporting, so reading status can consume fault indications. These reads did not write configuration, but they were not entirely without effects on status history.

The input-related status was consistent with doing this test without a charger supply. The significant configuration anomaly was register `0x02`.

## The unexpected 3.50 V setting

Bits 7 through 2 of register `0x02` select the battery regulation voltage, using a 3.50 V offset and 20 mV steps:

```text
Charge-voltage target = 3.50 V + ((register_0x02 >> 2) × 0.02 V)
```

For the observed `0x00`, that gives **3.50 V**. This is a configured charging target, not a measurement of the cell's present voltage.

The documented default target is **4.20 V**. A 3.50 V target could explain poor charging, but the register dump alone does not prove how it was set or describe every aspect of the original failure.

The BQ24250 is a charger rather than a fuel gauge. These registers do not provide battery percentage, remaining capacity, cycle count, measured cell voltage or current, or a numeric temperature reading.

## Resetting the registers

After confirming the pack's +5 V charger input was still disconnected, we issued the BQ24250's register-reset command: write **bit 7 of register `0x01` as 1**.

This resets charger configuration to device defaults. It is not a battery-health reset, and it does not restore any undocumented Xbox-specific settings. The following is the operation used on this pack, followed by three readbacks:

```bash
mpremote connect auto exec '
from machine import I2C, Pin
import time

i = I2C(0, sda=Pin(4), scl=Pin(5), freq=100000)

def dump():
    return " ".join("%02X" % i.readfrom_mem(0x6a, reg, 1)[0]
                    for reg in range(7))

print("BEFORE", dump())
control = i.readfrom_mem(0x6a, 0x01, 1)[0]
i.writeto_mem(0x6a, 0x01, bytes([control | 0x80]))

for n in range(3):
    time.sleep(1)
    print("AFTER", n + 1, dump())
'
```

The actual write value was `0xEC`. Although the control register had also read back as `0xEC`, writing its reset bit triggers an action; it is not a no-op merely because the byte matches the readback.

Result:

```text
BEFORE  3A EC 00 F8 02 A8 E0
AFTER 1 3A EC 8C F8 02 A8 E0
AFTER 2 3A EC 8C F8 02 A8 E0
AFTER 3 3A EC 8C F8 02 A8 E0
```

Register `0x02` changed from **`0x00` to `0x8C`**:

```text
0x8C >> 2 = 35
3.50 V + 35 × 0.02 V = 4.20 V
```

Its lowest two bits report the EN2/EN1 pin states on the BQ24250. They were both zero, consistent with the schematic, so the full readback need not match a generic default byte whose status bits differ.

All other observed register bytes remained unchanged. No charging supply was applied during the reset.

## The result

After the reset, **the pack charged normally again**.

The evidence is specific: I²C communication worked, the charger target changed from 3.50 V to 4.20 V, and charging subsequently worked. The original cause of the changed setting remains unknown, and there was no capacity or long-term retention test.

The most useful lesson from the wiring investigation was to distinguish schematic connector numbering from physical contact order. On this pack, **PNC was nearest AA+, and pulling it low enabled both the output and the I²C pull-up supply**.

## References

- [AcidMods discussion of the Xbox rechargeable pack](https://acidmods.com/forum/index.php?topic=44752.0). Useful background, but the later active-high activation claim did not match our confirmed test.
- RDC's [Xbox One Rechargeable Battery Model 1556 schematic (PDF)](https://www.acidmods.com/RDC/XB1/Schematics/XB1%201556%20PnC%20Pack%20DRAFT.pdf), revision 0.1, dated December 21, 2013. This is a reverse-engineered draft schematic.
- [Texas Instruments BQ24250/BQ24251/BQ24253 datasheet](https://www.ti.com/lit/ds/symlink/bq24250.pdf), especially section 9.6, Register Maps. The copy used here was SLUSBA1H, revised August 2015.
- [Raspberry Pi Pico 2 W pinout](https://datasheets.raspberrypi.com/picow/pico-2-w-pinout.pdf).
