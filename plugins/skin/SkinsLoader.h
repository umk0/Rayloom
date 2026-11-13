#ifndef SKINSLOADER_H
#define SKINSLOADER_H

#include <vector>
#include <string>
#include <QString>

class SkinsLoader
{
public:
    SkinsLoader();

    static std::vector<std::string> GetSkinFileNames();
    static QString LoadFile(QString);
    static QString LoadFileFromSkinsFolder(QString);
    static std::string GetSkinsFolderPath();
};

#endif // SKINSLOADER_H
