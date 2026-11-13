#include "OpenRGBSkinPlugin.h"
#include <QHBoxLayout>
#include <QString>
#include <QDir>
#include "SkinApplier.h"
#include "SkinSettings.h"

OpenRGBPluginAPIInterface* OpenRGBSkinPlugin::api = nullptr;

/*---------------------------------------------------------*\
| Plugin Information                                        |
\*---------------------------------------------------------*/
OpenRGBPluginInfo OpenRGBSkinPlugin::GetPluginInfo()
{
    OpenRGBPluginInfo info;
    info.Name           = PROJECT_NAME;
    info.Description    = PROJECT_DESC;
    info.Version        = VERSION_STRING;
    info.Commit         = GIT_COMMIT_ID;
    info.URL            = PROJECT_URL;
    info.Icon.load(":/OpenRGBSkinPlugin.png");

    info.Location       =  OPENRGB_PLUGIN_LOCATION_SETTINGS;
    info.Label          =  "Skins";
    info.TabIconString  =  "Skins";
    info.TabIcon.load(":/OpenRGBSkinPlugin.png");

    info.ProtocolVersion = 0;

    return info;
}

unsigned int OpenRGBSkinPlugin::GetPluginAPIVersion()
{
    return OPENRGB_PLUGIN_API_VERSION;
}

/*---------------------------------------------------------*\
| Plugin Functionality                                      |
\*---------------------------------------------------------*/
void OpenRGBSkinPlugin::Load(OpenRGBPluginAPIInterface* api_interface_ptr)
{
    /*-----------------------------------------------------*\
    | Store API interface pointer                           |
    \*-----------------------------------------------------*/
    api = api_interface_ptr;

    LOG_INFO("[OpenRGBSkinPlugin] Loading plugin.");
}

QWidget* OpenRGBSkinPlugin::GetWidget()
{
    LOG_INFO("[OpenRGBSkinPlugin] Creating widget.");

    /*-----------------------------------------------------*\
    | Make sure our skins folder is created                 |
    \*-----------------------------------------------------*/
    filesystem::path skins_dir = api->GetConfigurationDirectory() / "plugins" / "skins";

    LOG_INFO("[OpenRGBSkinPlugin] Creating skins directory.");

    bool created = QDir().mkpath(QString::fromStdString(skins_dir.string()));

    if(!created)
    {
        LOG_WARNING("[OpenRGBSkinPlugin] Not able to create the skins folder.");
    }

    SkinApplier* skin_applyer = new SkinApplier();

    /*-----------------------------------------------------*\
    | Restore the startup skin and whether it is enabled    |
    \*-----------------------------------------------------*/
    skin_applyer->RestoreSettings();

    return skin_applyer;
}

QMenu* OpenRGBSkinPlugin::GetTrayMenu()
{
    LOG_INFO("[OpenRGBSkinPlugin] Creating tray menu.");

    return nullptr;
}

void OpenRGBSkinPlugin::Unload()
{
    LOG_INFO("[OpenRGBSkinPlugin] Time to call some cleaning stuff.");
}

void OpenRGBSkinPlugin::OnProfileAboutToLoad()
{

}

void OpenRGBSkinPlugin::OnProfileLoad(nlohmann::json /*profile_data*/)
{

}

nlohmann::json OpenRGBSkinPlugin::OnProfileSave()
{
    nlohmann::json profile_json;

    return(profile_json);
}

#include "../LumenProtocol.h"
#include <QRegularExpression>
unsigned char* OpenRGBSkinPlugin::OnSDKCommand(unsigned int pkt_id, unsigned char* pkt_data, unsigned int* pkt_size)
{
    return lumen::Reply(pkt_id,pkt_data,pkt_size,[&](const lumen::json& r){
        auto settings=SkinSettings::LoadSettings();if(!settings.is_object())settings=lumen::json::object();
        auto method=r.at("method").get<std::string>();
        if(method=="config.set"){
            auto c=r.at("config");for(auto k:{"accent","background","panel","text"})if(!QRegularExpression("^#[0-9a-fA-F]{6}$").match(QString::fromStdString(c.at(k).get<std::string>())).hasMatch())throw std::runtime_error("Invalid theme color");
            if(!c.at("load_at_startup").is_boolean()||!c.at("name").is_string())throw std::runtime_error("Invalid theme");
            settings["lumen"]=c;SkinSettings::SaveSettings(settings);
        }else if(method!="config.get")throw std::runtime_error("Unknown skin method");
        return settings.value("lumen",lumen::json{{"name","Studio"},{"accent","#b4f17b"},{"background","#101113"},{"panel","#191a1e"},{"text","#e9e9ed"},{"load_at_startup",true}});
    });
}

/*---------------------------------------------------------*\
| Update Signals                                            |
\*---------------------------------------------------------*/
void OpenRGBSkinPlugin::ProfileManagerUpdated(unsigned int /*update_reason*/)
{

}

void OpenRGBSkinPlugin::ResourceManagerUpdated(unsigned int /*update_reason*/)
{

}

void OpenRGBSkinPlugin::SettingsManagerUpdated(unsigned int /*update_reason*/)
{

}

OpenRGBSkinPlugin::~OpenRGBSkinPlugin()
{
     printf("[OpenRGBSkinPlugin] Time to free some memory.\n");
}
