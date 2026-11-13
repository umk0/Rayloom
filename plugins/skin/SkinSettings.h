#ifndef SKINSETTINGS_H
#define SKINSETTINGS_H

#include <nlohmann/json.hpp>
#include "filesystem.h"

using json = nlohmann::json;

class SkinSettings
{
public:
    static void SaveSettings(json);
    static json LoadSettings();
    static bool CreateSettingsDirectory();

private:

    static filesystem::path SettingsFolder();
};

#endif // SKINSETTINGS_H
