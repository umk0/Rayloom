#include "SkinsLoader.h"
#include "OpenRGBSkinPlugin.h"
#include <QString>
#include <QDir>
#include <QFile>
#include <QTextStream>
#include "filesystem.h"

SkinsLoader::SkinsLoader()
{

}

std::vector<std::string> SkinsLoader::GetSkinFileNames()
{
    printf("[OpenRGBSkinPlugin] Listing skins...\n");

    filesystem::path path = OpenRGBSkinPlugin::api->GetConfigurationDirectory() / "plugins" / "skins";
    std::vector<std::string> filenames;

    QDir dir(QString::fromStdString(path.string()));

    if(dir.exists())
    {
        for (const QString & entry : dir.entryList(QDir::Files))
        {
            if(entry.endsWith(".qss"))
            {
                filenames.push_back(entry.toStdString());
            }
        }
    }

    printf("[OpenRGBSkinPlugin] Found %lu skin files\n", filenames.size());

    return filenames;
}

QString SkinsLoader::LoadFile(QString fileName)
{
    QFile f(fileName);

    if (!f.open(QFile::ReadOnly | QFile::Text))
    {
        return "";
    }

    QTextStream in(&f);

    return in.readAll();
}

QString SkinsLoader::LoadFileFromSkinsFolder(QString fileName)
{
    filesystem::path skin_file = OpenRGBSkinPlugin::api->GetConfigurationDirectory() / "plugins" / "skins" / fileName.toStdString();
    return LoadFile(QString::fromStdString(skin_file.string()));
}

std::string SkinsLoader::GetSkinsFolderPath()
{
    filesystem::path skins_folder = OpenRGBSkinPlugin::api->GetConfigurationDirectory() / "plugins" / "skins";
    return skins_folder.string();
}
