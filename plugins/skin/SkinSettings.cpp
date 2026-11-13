#include "SkinSettings.h"
#include "OpenRGBSkinPlugin.h"
#include <fstream>
#include <QDir>
#include <QString>

void SkinSettings::SaveSettings(json settings)
{
    if(!CreateSettingsDirectory())
    {
        printf("Cannot create settings directory.\n");
        return;
    }

    std::ofstream SFile((SettingsFolder() / "skins.json"), std::ios::out | std::ios::binary);

    if(SFile)
    {
        try{
            SFile << settings.dump(4);
            SFile.close();
            printf("Skins settings file successfully written.\n");
        }
        catch(const std::exception& e)
        {
            printf("Cannot write skins settings file.\n %s\n", e.what());
        }
        SFile.close();
    }
}

json SkinSettings::LoadSettings()
{
    json Settings;

    std::ifstream SFile(SettingsFolder() / "skins.json", std::ios::in | std::ios::binary);

    if(SFile)
    {
        try
        {
            SFile >> Settings;
            SFile.close();
        }
        catch(const std::exception& e)
        {
             printf("Cannot read skins settings file.\n %s\n", e.what());
        }
    }

    return Settings;
}

bool SkinSettings::CreateSettingsDirectory()
{
    filesystem::path directory = SettingsFolder();

    QDir dir(QString::fromStdString(directory.string()));

    if(dir.exists())
    {
        return true;
    }

    return QDir().mkpath(dir.path());
}

filesystem::path SkinSettings::SettingsFolder()
{
    return OpenRGBSkinPlugin::api->GetConfigurationDirectory() / "plugins" / "settings";
}
