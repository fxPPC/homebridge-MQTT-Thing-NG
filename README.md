# MQTT Thing NG

**Version 2.0.0‑beta.1**  
_Rewritten by **fxPPC** using OpenAI o3 reasoning AI._

## What is it?

**MQTT Thing NG** exposes any MQTT topic as a full‑featured HomeKit accessory in Homebridge.  
Based on the original mqttthing (by arachnetech), it supports lights, switches, sensors, locks, TVs, thermostats, and more—now on a modern, TypeScript‑driven, Homebridge v2 compatible core.

## Why the rewrite?

| Legacy issue           | NG solution                                         |
|------------------------|-----------------------------------------------------|
| ES5 code, no type safety | Strict TypeScript with ESLint + Jest             |
| Multiple MQTT clients  | Single shared MQTT.js 5 connection                  |
| Inline JS risks        | VM2 sandbox with 100 ms timeout                     |
| Node 12/14 EOL         | Node 18/20/22 support                               |
| No CI                  | GitHub Actions for lint + test                      |
