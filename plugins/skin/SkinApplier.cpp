#include "SkinApplier.h"
#include "ui_SkinApplier.h"

#include "SkinSettings.h"
#include "OpenRGBSkinPlugin.h"
#include "SkinsLoader.h"
#include <QApplication>
#include <QDir>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QSignalBlocker>
#include <QTextStream>
#include <QtGlobal>
#include <QDesktopServices>
#include <QStyle>
#include <QStyleFactory>
#include <QUrl>

/*---------------------------------------------------------*\
| Built-in skins that are available without a QSS file      |
\*---------------------------------------------------------*/
static const QString SKIN_SYSTEM_THEME      = QStringLiteral("System Theme");
static const QString SKIN_QT_FUSION_THEME   = QStringLiteral("Qt Fusion Theme");

/*---------------------------------------------------------*\
| Style name used by the Qt Fusion theme                    |
\*---------------------------------------------------------*/
static const QString FUSION_STYLE_NAME      = QStringLiteral("Fusion");

/*---------------------------------------------------------*\
| Style name for the native MacOS style.  Qt 6 uses         |
| "macos", Qt 5 uses "macintosh".  MacOS only, so other     |
| platforms do not build it in                              |
\*---------------------------------------------------------*/
#ifdef __APPLE__
#if QT_VERSION >= QT_VERSION_CHECK(6, 0, 0)
static const QString MACOS_STYLE_NAME = QStringLiteral("macos");
#else
static const QString MACOS_STYLE_NAME = QStringLiteral("macintosh");
#endif
#endif

/*---------------------------------------------------------*\
| Style name the application started with, captured once    |
| so QSS skins can be applied on top of it.  Note: on       |
| MacOS OpenRGB forces the Qt Fusion style at startup, so   |
| this will be "Fusion" there and must NOT be used for the  |
| System Theme option                                       |
\*---------------------------------------------------------*/
static QString default_style_name;

/*---------------------------------------------------------*\
| Return the built-in theme that matches the style the      |
| application was started with.  OpenRGB applies the Qt     |
| Fusion theme on MacOS, while every other platform uses    |
| the system theme                                          |
\*---------------------------------------------------------*/
static QString DefaultBuiltInTheme(const QString& startup_style_name)
{
    bool use_fusion = (startup_style_name.compare(FUSION_STYLE_NAME, Qt::CaseInsensitive) == 0);

#ifdef __APPLE__
    /*-----------------------------------------------------*\
    | MacOS always uses the Qt Fusion theme                 |
    \*-----------------------------------------------------*/
    use_fusion = true;
#endif

    if(use_fusion)
    {
        return(SKIN_QT_FUSION_THEME);
    }

    return(SKIN_SYSTEM_THEME);
}

/*---------------------------------------------------------*\
| Return the QStyle key for the native system theme.  On    |
| MacOS, OpenRGB forces Qt Fusion at startup, so the        |
| captured startup style (Fusion) must NOT be used - use    |
| the native MacOS style key instead.  Every other          |
| platform uses the style the app started with              |
\*---------------------------------------------------------*/
static QString SystemStyleName()
{
#ifdef __APPLE__
    return(MACOS_STYLE_NAME);
#else
    return(default_style_name);
#endif
}

SkinApplier::SkinApplier(QWidget *parent) :
    QWidget(parent),
    ui(new Ui::SkinApplier)
{
    ui->setupUi(this);
    app = dynamic_cast<QApplication*>(QApplication::instance());

    /*-----------------------------------------------------*\
    | Remember the startup style before anything changes it |
    \*-----------------------------------------------------*/
    if(default_style_name.isEmpty() && (app != nullptr))
    {
        default_style_name = app->style()->objectName();
    }

    /*-----------------------------------------------------*\
    | Built-in themes are always available, even when there |
    | are no skin files                                     |
    \*-----------------------------------------------------*/
    PopulateSkinsList(ui->skins_list);
    PopulateSkinsList(ui->startup_skins_list);

    /*-----------------------------------------------------*\
    | Select the theme the application is actually running  |
    | with in the active theme box.  MacOS uses the Qt      |
    | Fusion theme, every other platform uses the system    |
    | theme.  setCurrentIndex() does not emit activated(),  |
    | so this only updates the box and does not reapply     |
    \*-----------------------------------------------------*/
    int default_index = ui->skins_list->findText(DefaultBuiltInTheme(default_style_name));

    if(default_index >= 0)
    {
        ui->skins_list->setCurrentIndex(default_index);
    }
}

SkinApplier::~SkinApplier()
{
    delete ui;
}

void SkinApplier::RestoreSettings()
{
    json settings = SkinSettings::LoadSettings();

    /*-----------------------------------------------------*\
    | Settings from older versions stored the skin name in  |
    | load_at_startup instead of separate keys.  Migrate it |
    | so the checkbox and combobox both have a value        |
    \*-----------------------------------------------------*/
    if(settings.contains("load_at_startup") && settings["load_at_startup"].is_string())
    {
        std::string legacy_skin = settings["load_at_startup"];

        settings.erase("load_at_startup");

        if(!legacy_skin.empty())
        {
            settings["startup_skin"]     = legacy_skin;
            settings["load_at_startup"]  = true;

            SkinSettings::SaveSettings(settings);
        }
    }

    /*-----------------------------------------------------*\
    | Read the settings directly from the json object       |
    | rather than using JsonUtils, which is not linked into |
    | the plugin                                            |
    \*-----------------------------------------------------*/
    QString startup_skin;

    if(settings.contains("startup_skin") && settings["startup_skin"].is_string())
    {
        startup_skin = QString::fromStdString(settings["startup_skin"].get<std::string>());
    }

    bool load_at_startup = false;

    if(settings.contains("load_at_startup") && settings["load_at_startup"].is_boolean())
    {
        load_at_startup = settings["load_at_startup"].get<bool>();
    }

    int startup_index = ui->startup_skins_list->findText(startup_skin);

    if(startup_index >= 0)
    {
        ui->startup_skins_list->setCurrentIndex(startup_index);
    }

    /*-----------------------------------------------------*\
    | Block signals so restoring the widget state does not  |
    | rewrite the settings file at startup                  |
    \*-----------------------------------------------------*/
    {
        QSignalBlocker blocker(ui->load_at_startup);

        ui->load_at_startup->setChecked(load_at_startup);
    }

    if(!load_at_startup)
    {
        return;
    }

    /*-----------------------------------------------------*\
    | The startup skin must exist in the active theme box.  |
    | If it does not, for instance because the QSS file was |
    | removed, fall back to the default theme for this      |
    | platform so the box always matches what is applied    |
    \*-----------------------------------------------------*/
    if(ui->skins_list->findText(startup_skin) < 0)
    {
        startup_skin = DefaultBuiltInTheme(default_style_name);
    }

    int index = ui->skins_list->findText(startup_skin);

    if(index >= 0)
    {
        ui->skins_list->setCurrentIndex(index);
    }

    ApplySkin(startup_skin);
}

void SkinApplier::PopulateSkinsList(QComboBox* skins_list)
{
    if(skins_list == nullptr)
    {
        return;
    }

    skins_list->addItem(SKIN_SYSTEM_THEME);
    skins_list->addItem(SKIN_QT_FUSION_THEME);

    std::vector<std::string> skins = SkinsLoader::GetSkinFileNames();

    for(std::string skin:skins)
    {
        skins_list->addItem(QString::fromStdString(skin));
    }
}

void SkinApplier::ApplySkin(QString skin)
{
    if(app == nullptr)
    {
        return;
    }

    active_skin_name = skin;

    /*-----------------------------------------------------*\
    | Built-in themes do not load a QSS file                |
    \*-----------------------------------------------------*/
    if(skin == SKIN_SYSTEM_THEME)
    {
        ApplySystemTheme();
        return;
    }

    if(skin == SKIN_QT_FUSION_THEME)
    {
        ApplyFusionTheme();
        return;
    }

    /*-----------------------------------------------------*\
    | Apply QSS skins on top of the startup style           |
    \*-----------------------------------------------------*/
    ApplyDefaultStyle();

    app->setStyleSheet(SkinsLoader::LoadFileFromSkinsFolder(skin));
}

void SkinApplier::ApplySystemTheme()
{
    ApplySystemStyle();

    app->setStyleSheet(QString());
}

void SkinApplier::ApplyFusionTheme()
{
    app->setStyleSheet(QString());

    if(app->style()->objectName().compare(FUSION_STYLE_NAME, Qt::CaseInsensitive) == 0)
    {
        return;
    }

    QStyle* fusion_style = QStyleFactory::create(FUSION_STYLE_NAME);

    if(fusion_style != nullptr)
    {
        app->setStyle(fusion_style);
    }
}

void SkinApplier::ApplyDefaultStyle()
{
    if(default_style_name.isEmpty())
    {
        return;
    }

    if(app->style()->objectName().compare(default_style_name, Qt::CaseInsensitive) == 0)
    {
        return;
    }

    QStyle* default_style = QStyleFactory::create(default_style_name);

    if(default_style != nullptr)
    {
        app->setStyle(default_style);
    }
}

void SkinApplier::ApplySystemStyle()
{
    QString system_style_name = SystemStyleName();

    if(system_style_name.isEmpty())
    {
        return;
    }

    if(app->style()->objectName().compare(system_style_name, Qt::CaseInsensitive) == 0)
    {
        return;
    }

    QStyle* system_style = QStyleFactory::create(system_style_name);

    if(system_style != nullptr)
    {
        app->setStyle(system_style);
    }
}

void SkinApplier::on_open_skin_file_clicked()
{
    QString fileName = QFileDialog::getOpenFileName(this, tr("Install skin from file"), "", tr("QSS Files (*.qss)"));

    if(fileName.isEmpty())
    {
        return;
    }

    InstallSkinFromFile(fileName);
}

void SkinApplier::InstallSkinFromFile(QString fileName)
{
    if(fileName.isEmpty() || (app == nullptr))
    {
        return;
    }

    ApplyDefaultStyle();

    app->setStyleSheet(SkinsLoader::LoadFile(fileName));

    QString   skin_name  = QFileInfo(fileName).fileName();

    active_skin_name = skin_name;

    /*-----------------------------------------------------*\
    | Copy the skin into the skins folder so it is added to |
    | the list, can be re-applied, and can be loaded at     |
    | startup                                               |
    \*-----------------------------------------------------*/
    std::string skins_dir  = SkinsLoader::GetSkinsFolderPath();
    QString     skins_path = QString::fromStdString(skins_dir);

    if(!skins_dir.empty())
    {
        QString target_dir = QDir::cleanPath(skins_path);
        QString source_dir = QDir::cleanPath(QFileInfo(fileName).absolutePath());

        if(source_dir != target_dir)
        {
            QDir().mkpath(target_dir);

            if(QFile::exists(target_dir + "/" + skin_name))
            {
                QFile::remove(target_dir + "/" + skin_name);
            }

            QFile::copy(fileName, target_dir + "/" + skin_name);
        }
    }

    AddSkinToList(skin_name);
}

void SkinApplier::AddSkinToList(QString skin_name)
{
    /*-----------------------------------------------------*\
    | Add the skin to the startup list too, so it can be    |
    | selected to load at startup                           |
    \*-----------------------------------------------------*/
    int startup_index = ui->startup_skins_list->findText(skin_name);

    if(startup_index < 0)
    {
        ui->startup_skins_list->addItem(skin_name);
        startup_index = ui->startup_skins_list->count() - 1;
    }

    int index = ui->skins_list->findText(skin_name);

    if(index < 0)
    {
        ui->skins_list->addItem(skin_name);
        index = ui->skins_list->count() - 1;
    }

    ui->skins_list->setCurrentIndex(index);
}

void SkinApplier::on_skins_list_activated(int /*index*/)
{
    QString skin = ui->skins_list->currentText();

    if(skin.isEmpty())
    {
        return;
    }

    ApplySkin(skin);
}

void SkinApplier::on_open_skins_folder_clicked()
{
    filesystem::path config_dir = OpenRGBSkinPlugin::api->GetConfigurationDirectory() / "plugins" / "skins";
    QUrl url = QUrl::fromLocalFile(QString::fromStdString(config_dir.string()));

    printf("Opening %s\n", url.path().toStdString().c_str());

    QDesktopServices::openUrl(url);
}

void SkinApplier::on_startup_skins_list_activated(int /*index*/)
{
    /*-----------------------------------------------------*\
    | The startup list only chooses which skin to load at   |
    | startup, it does not apply the skin immediately       |
    \*-----------------------------------------------------*/
    SaveStartupSettings();
}

void SkinApplier::SaveStartupSettings()
{
    json settings;

    settings["load_at_startup"] = ui->load_at_startup->isChecked();
    settings["startup_skin"]    = ui->startup_skins_list->currentText().toStdString();

    SkinSettings::SaveSettings(settings);
}

void SkinApplier::on_load_at_startup_stateChanged(int)
{
    SaveStartupSettings();
}
