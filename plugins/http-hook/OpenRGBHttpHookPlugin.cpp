/*---------------------------------------------------------*\
| OpenRGBHttpHookPlugin.cpp                                 |
|                                                           |
|   OpenRGB Http Hook Plugin                                |
|                                                           |
|   This file is part of the OpenRGB Http Hook Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#include "OpenRGBHttpHookPlugin.h"

/*---------------------------------------------------------*\
| ProfileManager Update Reason Codes                        |
\*---------------------------------------------------------*/
enum
{
    PROFILEMANAGER_UPDATE_REASON_PROFILE_LIST_UPDATED,          /* Profile list updated             */
    PROFILEMANAGER_UPDATE_REASON_ACTIVE_PROFILE_CHANGED,        /* Active profile changed           */
    PROFILEMANAGER_UPDATE_REASON_PROFILE_ABOUT_TO_LOAD,         /* Profile about to load            */
};

OpenRGBPluginAPIInterface* OpenRGBHttpHookPlugin::api = nullptr;

OpenRGBHttpHookPlugin::OpenRGBHttpHookPlugin()
{

}

OpenRGBHttpHookPlugin::~OpenRGBHttpHookPlugin()
{

}

/*---------------------------------------------------------*\
| Plugin Information                                        |
\*---------------------------------------------------------*/
OpenRGBPluginInfo OpenRGBHttpHookPlugin::GetPluginInfo()
{
    OpenRGBPluginInfo info;

    info.Name           = PROJECT_NAME;
    info.Description    = PROJECT_DESC;
    info.Version        = VERSION_STRING;
    info.Commit         = GIT_COMMIT_ID;
    info.URL            = PROJECT_URL;

    info.Icon.load(":/OpenRGBHttpHookPlugin.png");

    info.Location       = OPENRGB_PLUGIN_LOCATION_TOP;
    info.Label          = "HTTP Hook";
    info.TabIconString  = "HTTP Hook";

    info.TabIcon.load(":/OpenRGBHttpHookPlugin.png");

    return info;
}

unsigned int OpenRGBHttpHookPlugin::GetPluginAPIVersion()
{
    return OPENRGB_PLUGIN_API_VERSION;
}

/*---------------------------------------------------------*\
| Plugin Functionality                                      |
\*---------------------------------------------------------*/
void OpenRGBHttpHookPlugin::Load(OpenRGBPluginAPIInterface* api_interface_ptr)
{
    /*-----------------------------------------------------*\
    | Store API interface pointer                           |
    \*-----------------------------------------------------*/
    api = api_interface_ptr;

    /*-----------------------------------------------------*\
    | Log initial messages                                  |
    \*-----------------------------------------------------*/
    LOG_INFO("[OpenRGBHttpHookPlugin] Loading plugin.");

    /*-----------------------------------------------------*\
    | Create the main UI widget                             |
    \*-----------------------------------------------------*/
    ui = new HttpHookMainView();
}

QWidget* OpenRGBHttpHookPlugin::GetWidget()
{
    return ui;
}

QMenu* OpenRGBHttpHookPlugin::GetTrayMenu()
{
    return nullptr;
}

void OpenRGBHttpHookPlugin::Unload()
{
    /*-----------------------------------------------------*\
    | Log unload message                                    |
    \*-----------------------------------------------------*/
    LOG_INFO("[OpenRGBHttpHookPlugin] Unloading");

    /*-----------------------------------------------------*\
    | Stop the server before the plugin unloads             |
    \*-----------------------------------------------------*/
    if(ui != nullptr)
    {
        ui->Stop();
        
        /*-------------------------------------------------*\
        | Destroy the whole view                            |
        \*-------------------------------------------------*/
        delete ui;
        ui = nullptr;
    }
}

void OpenRGBHttpHookPlugin::OnProfileAboutToLoad()
{

}

void OpenRGBHttpHookPlugin::OnProfileLoad(nlohmann::json /*profile_data*/)
{

}

nlohmann::json OpenRGBHttpHookPlugin::OnProfileSave()
{
    nlohmann::json profile_json;

    return(profile_json);
}

#include "../LumenProtocol.h"
unsigned char* OpenRGBHttpHookPlugin::OnSDKCommand(unsigned int pkt_id, unsigned char* data, unsigned int* data_size)
{
    return lumen::Reply(pkt_id,data,data_size,[&](const lumen::json& r){return ui->LumenCommand(r);});
}

/*---------------------------------------------------------*\
| Update Signals                                            |
\*---------------------------------------------------------*/
void OpenRGBHttpHookPlugin::ProfileManagerUpdated(unsigned int update_reason)
{
    /*-----------------------------------------------------*\
    | When the profile list changes (e.g. a profile is      |
    | created, deleted, or renamed), refresh the profile    |
    | list shown in every hook entry so they always reflect |
    | the current set of available profiles.                |
    \*-----------------------------------------------------*/
    if(update_reason == PROFILEMANAGER_UPDATE_REASON_PROFILE_LIST_UPDATED)
    {
        if(ui != nullptr)
        {
            ui->UpdateProfileList();
        }
    }
}

void OpenRGBHttpHookPlugin::ResourceManagerUpdated(unsigned int /*update_reason*/)
{

}

void OpenRGBHttpHookPlugin::SettingsManagerUpdated(unsigned int /*update_reason*/)
{

}
