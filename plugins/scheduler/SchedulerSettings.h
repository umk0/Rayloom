/*---------------------------------------------------------*\
| SchedulerSettings.h                                       |
|                                                           |
|   Scheduler settings                                      |
|                                                           |
|   This file is part of the OpenRGB Scheduler Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#pragma once

#include <nlohmann/json.hpp>
#include "filesystem.h"

using json = nlohmann::json;

class SchedulerSettings
{
public:
    static void Save(json);
    static json Load();

private:
    static bool CreateSettingsDirectory();
    static filesystem::path SettingsFolder();
};
