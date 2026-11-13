#include "../core/Controllers/KeychronKeyboardController/KeychronKeyboardDetection.h"
#include <cassert>

int main()
{
    // Captured product descriptor of the physically connected Valkyrie VK99.
    assert(IsKnownNonKeychronProduct(L"KD98"));
    // Keep the genuine legacy device and missing descriptor behavior.
    assert(!IsKnownNonKeychronProduct(L"Keychron K3"));
    assert(!IsKnownNonKeychronProduct(L"Gaming Keyboard"));
    assert(!IsKnownNonKeychronProduct(L""));
    assert(!IsKnownNonKeychronProduct(nullptr));
    // A VK99 being evaluated must not suppress another keyboard afterwards.
    assert(IsKnownNonKeychronProduct(L"KD98"));
    assert(!IsKnownNonKeychronProduct(L"Keychron K3"));
}
