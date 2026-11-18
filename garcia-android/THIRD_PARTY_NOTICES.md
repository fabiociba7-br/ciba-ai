# Third-party notices

## stable-diffusion.cpp

- Project: https://github.com/leejet/stable-diffusion.cpp
- Revision: 532d2c15c430a785a712b2d94281f04e733008a4
- License: MIT
- Copyright (c) 2023 leejet

The stable-diffusion.cpp source is fetched at Android build time and linked into
Garcia's native image-generation library. Its MIT license permits commercial
use, modification, and distribution, subject to retaining this notice.

## Model weights

Model weights are not bundled with Garcia. The user must supply a compatible
local checkpoint. Model weights have their own licenses and acceptable-use
terms, which are separate from the engine's MIT license. Garcia does not fetch
or call an inference API, remote model endpoint, or generation server.
