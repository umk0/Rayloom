#include "../core/Controllers/ENESMBusController/ENEDescriptorRead.h"
#include <cassert>
#include <cstring>
#include <vector>

static ENEDescriptorSnapshot Snapshot(const char* name)
{
    ENEDescriptorSnapshot snapshot;
    std::memcpy(snapshot.name.data(), name, std::strlen(name));
    snapshot.config[0] = 1; snapshot.config[1] = 1;
    snapshot.config[2] = 8; snapshot.config[3] = 8;
    return snapshot;
}

static ENEDescriptorReadResult Run(const std::vector<ENEDescriptorSnapshot>& snapshots,
    int fail_attempt, ENEDescriptorSnapshot& output, unsigned int& pauses, unsigned int& attempts)
{
    attempts = 0; pauses = 0;unsigned int current = 0;
    return ReadStableENEDescriptor([&](unsigned short reg, unsigned char& value) {
        if(reg == 0x1000) { current = attempts++; if(static_cast<int>(current) == fail_attempt)return false; }
        assert(current < snapshots.size());
        value = reg < 0x1C00 ? snapshots[current].name[reg - 0x1000] : snapshots[current].config[reg - 0x1C00];
        return true;
    }, [&]() { ++pauses; }, 0x1000, 0x1C00, output);
}

int main()
{
    const auto good = Snapshot("AUDA0-E6K5-0101"), unknown = Snapshot("AUDA0-E6H5-0101");
    ENEDescriptorSnapshot out;unsigned int pauses, attempts;
    auto result = Run({good, good}, -1, out, pauses, attempts);
    assert(result.stable && result.attempts == 2 && pauses == 1 && out == good);
    // Observed K->H read corruption can recover only from two real matching reads.
    result = Run({unknown, good, good}, -1, out, pauses, attempts);
    assert(result.stable && attempts == 3 && pauses == 2 && out == good);
    result = Run({good, unknown, good}, -1, out, pauses, attempts);
    assert(!result.stable && attempts == 3 && pauses == 2);
    assert(result.mismatches == 2 && result.first_difference_register == 0x1008);
    assert(result.first_previous_value == 'K' && result.first_current_value == 'H');
    result = Run({good, good, good}, 0, out, pauses, attempts);
    assert(result.stable && result.failures == 1 && attempts == 3 && out == good);
    result = Run({good, good, good}, 1, out, pauses, attempts);
    assert(!result.stable && result.failures == 1 && attempts == 3);
    // A stable unknown identity stays unknown; there is no H->K substitution.
    result = Run({unknown, unknown}, -1, out, pauses, attempts);
    assert(result.stable && out == unknown && !(out == good));
    auto different_config = good;different_config.config[2] = 0xff;
    result = Run({good, different_config, good}, -1, out, pauses, attempts);
    assert(!result.stable && attempts == 3);
    assert(result.first_difference_register == 0x1C02);
    assert(result.first_previous_value == 8 && result.first_current_value == 0xff);
    // An otherwise stable descriptor may have changing unused/reserved bytes.
    auto unused_volatile = good;
    for(unsigned int i = 0; i < unused_volatile.config.size(); ++i)
        if(!IsENEDescriptorConfigField(i))unused_volatile.config[i] ^= 0xff;
    result = Run({good, unused_volatile}, -1, out, pauses, attempts);
    assert(result.stable && attempts == 2 && result.mismatches == 0 && out == unused_volatile);
    // Firmware identity follows the same first-NUL semantics as native strcmp.
    const auto short_name = Snapshot("DIMM_LED-0102");
    auto padded_name = short_name;
    padded_name.name[14] = 0x55;padded_name.name[15] = 0xaa;
    result = Run({short_name, padded_name}, -1, out, pauses, attempts);
    assert(result.stable && attempts == 2 && result.mismatches == 0 && out == short_name);
    // A character change before the terminator is still an identity mismatch.
    auto changed_name = short_name;changed_name.name[11] = '9';
    result = Run({short_name, changed_name, short_name}, -1, out, pauses, attempts);
    assert(!result.stable && result.first_difference_register == 0x100B);
    // Every byte used for LED count, zone size or either channel table matters.
    for(unsigned int offset = 0; offset < good.config.size(); ++offset)
    {
        if(!IsENEDescriptorConfigField(offset))continue;
        auto changed = good;changed.config[offset] ^= 0xff;
        result = Run({good, changed, good}, -1, out, pauses, attempts);
        assert(!result.stable && attempts == 3 && result.mismatches == 2);
        assert(result.first_difference_register == 0x1C00 + offset);
    }
}
