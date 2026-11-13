/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include <array>

struct ENEDescriptorSnapshot
{
    std::array<unsigned char, 16> name{};
    std::array<unsigned char, 64> config{};
    bool operator==(const ENEDescriptorSnapshot& other) const
    {
        return name == other.name && config == other.config;
    }
};

struct ENEDescriptorReadResult
{
    bool stable = false;
    unsigned int attempts = 0;
    unsigned int failures = 0;
    unsigned int mismatches = 0;
    unsigned short first_difference_register = 0;
    unsigned char first_previous_value = 0;
    unsigned char first_current_value = 0;
};

// These are the only configuration bytes consumed by ENESMBusController:
// total/per-zone LED counts, and the eight channel IDs in either table version.
// Reserved bytes are still read for the diagnostic dump but do not identify a
// device or determine how the driver addresses its LEDs.
inline bool IsENEDescriptorConfigField(unsigned int offset)
{
    return (offset >= 0x02 && offset <= 0x0A) ||
           (offset >= 0x13 && offset <= 0x22);
}

// No fuzzy identity matching and no device/address rescan. The reader must
// report transport errors; two consecutive snapshots must agree on exact
// firmware identity and all configuration fields consumed by the driver.
// Exactly three attempts at most, with the caller's short pause between them.
template<typename Reader, typename Pause>
ENEDescriptorReadResult ReadStableENEDescriptor(Reader read, Pause pause,
    unsigned short name_register, unsigned short config_register,
    ENEDescriptorSnapshot& output)
{
    ENEDescriptorReadResult result;
    ENEDescriptorSnapshot previous;
    bool have_previous = false;
    output = {};
    for(unsigned int attempt = 0; attempt < 3; ++attempt)
    {
        result.attempts = attempt + 1;
        ENEDescriptorSnapshot candidate;
        bool valid = true;
        for(unsigned int i = 0; i < candidate.name.size() && valid; ++i)
            valid = read(static_cast<unsigned short>(name_register + i), candidate.name[i]);
        // The native driver uses a 15-character C string. The last hardware
        // byte was already discarded upstream; do not compare unused padding.
        candidate.name.back() = 0;
        bool terminated = false;
        for(auto& value : candidate.name)
        {
            if(value == 0)terminated = true;
            if(terminated)value = 0;
        }
        for(unsigned int i = 0; i < candidate.config.size() && valid; ++i)
            valid = read(static_cast<unsigned short>(config_register + i), candidate.config[i]);
        if(valid && have_previous)
        {
            const auto equal_byte = [&](unsigned short reg, unsigned char before, unsigned char after) {
                if(before == after)return true;
                if(result.mismatches == 0)
                {
                    result.first_difference_register = reg;
                    result.first_previous_value = before;
                    result.first_current_value = after;
                }
                ++result.mismatches;
                return false;
            };
            bool same = true;
            for(unsigned int i = 0; i < candidate.name.size() && same; ++i)
                same = equal_byte(static_cast<unsigned short>(name_register + i), previous.name[i], candidate.name[i]);
            for(unsigned int i = 0; i < candidate.config.size() && same; ++i)
                if(IsENEDescriptorConfigField(i))
                    same = equal_byte(static_cast<unsigned short>(config_register + i), previous.config[i], candidate.config[i]);
            if(same)
            {
                output = candidate;
                result.stable = true;
                return result;
            }
        }
        if(!valid)++result.failures;
        previous = candidate;
        have_previous = valid;
        if(attempt < 2)pause();
    }
    return result;
}
