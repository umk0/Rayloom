/*---------------------------------------------------------*\
| SchedulerSettings.cpp                                     |
|                                                           |
|   Scheduler settings                                      |
|                                                           |
|   This file is part of the OpenRGB Scheduler Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#include "SchedulerSettings.h"
#include <fstream>
#include <iostream>
#include <QFile>
#include <QString>
#include <QDir>
#include "OpenRGBSchedulerPlugin.h"

void SchedulerSettings::Save(json Settings)
{
    if(!CreateSettingsDirectory())
    {
        printf("Cannot create settings directory.\n");
        return;
    }

    std::ofstream File((SettingsFolder() / "SchedulerSettings.json"), std::ios::out | std::ios::binary);

    if(File)
    {
        try{
            File << Settings.dump(4);
        }
        catch(const std::exception& e)
        {
            printf("Cannot write settings: %s\n", e.what());
        }
        File.close();
    }
}

json SchedulerSettings::Load()
{
    json Settings;

    std::ifstream SFile(SettingsFolder() / "SchedulerSettings.json", std::ios::in | std::ios::binary);

    if(SFile)
    {
        try
        {
            SFile >> Settings;
            SFile.close();
        }
        catch(const std::exception& e)
        {
            printf("Cannot read settings: %s\n", e.what());
        }
    }

    return Settings;
}

bool SchedulerSettings::CreateSettingsDirectory()
{
    filesystem::path directory = SettingsFolder();

    QDir dir(QString::fromStdString(directory.string()));

    if(dir.exists())
    {
        return true;
    }

    return QDir().mkpath(dir.path());
}

filesystem::path SchedulerSettings::SettingsFolder()
{
    return OpenRGBSchedulerPlugin::api->GetConfigurationDirectory() / "plugins" / "settings";
}
