/*---------------------------------------------------------*\
| HookSettings.cpp                                          |
|                                                           |
|   Hook settings persistence                               |
|                                                           |
|   This file is part of the OpenRGB Http Hook Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#include "HookSettings.h"
#include <fstream>
#include <iostream>
#include <QFile>
#include <QString>
#include <QDir>
#include "OpenRGBHttpHookPlugin.h"

void HookSettings::Save(json Settings)
{
    if(!CreateSettingsDirectory())
    {
        printf("[OpenRGBHttpHookPlugin] Cannot create settings directory.\n");
        return;
    }

    std::ofstream File((SettingsFolder() / "HttpHookSettings.json"), std::ios::out | std::ios::binary);

    if(File)
    {
        try{
            File << Settings.dump(4);
        }
        catch(const std::exception& e)
        {
            printf("[OpenRGBHttpHookPlugin] Cannot write settings: %s\n", e.what());
        }
        File.close();
    }
}

json HookSettings::Load()
{
    json Settings;

    std::ifstream SFile(SettingsFolder() / "HttpHookSettings.json", std::ios::in | std::ios::binary);

    if(SFile)
    {
        try
        {
            SFile >> Settings;
            SFile.close();
        }
        catch(const std::exception& e)
        {
            printf("[OpenRGBHttpHookPlugin] Cannot read settings: %s\n", e.what());
        }
    }

    return Settings;
}

bool HookSettings::CreateSettingsDirectory()
{
    filesystem::path directory = SettingsFolder();

    QDir dir(QString::fromStdString(directory.string()));

    if(dir.exists())
    {
        return true;
    }

    return QDir().mkpath(dir.path());
}

filesystem::path HookSettings::SettingsFolder()
{
    return OpenRGBHttpHookPlugin::api->GetConfigurationDirectory() / "plugins" / "settings";
}
