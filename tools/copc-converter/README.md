# AeroData COPC Converter

Turns a DJI Terra LiDAR deliverable (one or many `.las` / `.laz` files, in any
folder layout) into a single **`.copc.laz`** — a lossless, streaming-ready
point cloud. Every point, coordinate, color, and classification survives
bit-for-bit; the file just gets an internal level-of-detail index (and usually
shrinks to a quarter of the size).

The output is what you upload for clients: the AeroData Scan Viewer streams it
so a 50 GB site appears in seconds, with full captured density wherever the
client zooms.

## One-time setup

Double-click **`Install-Converter.bat`**. It installs Miniforge (a free
scientific-software manager) and the conversion tools (PDAL + Untwine).
Takes a few minutes; needs ~2 GB of disk.

## Converting a site

Drag the processed-output folder (or any selection of `.las`/`.laz` files)
onto **`Make-COPC.bat`**. A window shows progress; when it finishes you'll
have `<name>.copc.laz` next to what you dropped.

Big sites take a while — roughly 5–15 minutes per 50 GB on an SSD. The tool
works out-of-core, so it handles files far larger than your RAM.

## Checking a result

Drop the finished `.copc.laz` into the Scan Viewer
(https://lukasmadams11.github.io/aerodata-site/viewer.html) — it opens like
any other LAZ file.
