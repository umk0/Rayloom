/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once

#include <cwchar>

// VK99's KD98 USB product reuses the legacy Keychron VID/PID and exposes
// a boot-keyboard interface that also matches Keychron's interface filter.
// Check this device's descriptor, not whether any VK99 is connected: both
// keyboards must still work when plugged in together. Unknown descriptors
// retain upstream behavior until a collision is established for that model.
inline bool IsKnownNonKeychronProduct(const wchar_t* product)
{
    return product && std::wcscmp(product, L"KD98") == 0;
}
