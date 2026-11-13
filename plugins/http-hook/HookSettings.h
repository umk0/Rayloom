/*---------------------------------------------------------*\
| HookSettings.h                                            |
|                                                           |
|   Hook settings persistence                               |
|                                                           |
|   This file is part of the OpenRGB Http Hook Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#pragma once

#include <nlohmann/json.hpp>
#include "filesystem.h"

using json = nlohmann::json;

class HookSettings
{
public:
    static void Save(json);
    static json Load();

private:
    static bool CreateSettingsDirectory();
    static filesystem::path SettingsFolder();
};
