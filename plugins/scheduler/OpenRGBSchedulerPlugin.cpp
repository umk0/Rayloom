/*---------------------------------------------------------*\
| OpenRGBSchedulerPlugin.cpp                                |
|                                                           |
|   OpenRGB Scheduler Plugin                                |
|                                                           |
|   This file is part of the OpenRGB Scheduler Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#include <QHBoxLayout>
#include "OpenRGBSchedulerPlugin.h"

/*---------------------------------------------------------*\
| ProfileManager Update Reason Codes                        |
\*---------------------------------------------------------*/
enum
{
    PROFILEMANAGER_UPDATE_REASON_PROFILE_LIST_UPDATED,          /* Profile list updated             */
    PROFILEMANAGER_UPDATE_REASON_ACTIVE_PROFILE_CHANGED,        /* Active profile changed           */
    PROFILEMANAGER_UPDATE_REASON_PROFILE_ABOUT_TO_LOAD,         /* Profile about to load            */
};

OpenRGBPluginAPIInterface* OpenRGBSchedulerPlugin::api = nullptr;

OpenRGBSchedulerPlugin::OpenRGBSchedulerPlugin()
{

}

OpenRGBSchedulerPlugin::~OpenRGBSchedulerPlugin()
{
    
}

/*---------------------------------------------------------*\
| Plugin Information                                        |
\*---------------------------------------------------------*/
OpenRGBPluginInfo OpenRGBSchedulerPlugin::GetPluginInfo()
{
    OpenRGBPluginInfo info;

    info.Name           = PROJECT_NAME;
    info.Description    = PROJECT_DESC;
    info.Version        = VERSION_STRING;
    info.Commit         = GIT_COMMIT_ID;
    info.URL            = PROJECT_URL;

    info.Icon.load(":/OpenRGBSchedulerPlugin.png");

    info.Location       = OPENRGB_PLUGIN_LOCATION_TOP;
    info.Label          = "Scheduler";
    info.TabIconString  = "Scheduler";

    info.TabIcon.load(":/OpenRGBSchedulerPlugin.png");

    return info;
}

unsigned int OpenRGBSchedulerPlugin::GetPluginAPIVersion()
{
    return OPENRGB_PLUGIN_API_VERSION;
}

/*---------------------------------------------------------*\
| Plugin Functionality                                      |
\*---------------------------------------------------------*/
void OpenRGBSchedulerPlugin::Load(OpenRGBPluginAPIInterface* api_interface_ptr)
{
    /*-----------------------------------------------------*\
    | Store API interface pointer                           |
    \*-----------------------------------------------------*/
    api = api_interface_ptr;

    /*-----------------------------------------------------*\
    | Log initial messages                                  |
    \*-----------------------------------------------------*/
    LOG_INFO("[OpenRGBSchedulerPlugin] Loading plugin.");

    /*-----------------------------------------------------*\
    | Create the main UI widget                             |
    \*-----------------------------------------------------*/
    ui = new SchedulerMainView();
}

QWidget* OpenRGBSchedulerPlugin::GetWidget()
{
    return ui;
}

QMenu* OpenRGBSchedulerPlugin::GetTrayMenu()
{
    return nullptr;
}

void OpenRGBSchedulerPlugin::Unload()
{
    /*-----------------------------------------------------*\
    | Log unload message                                    |
    \*-----------------------------------------------------*/
    LOG_INFO("[OpenRGBSchedulerPlugin] Unloading");

    /*-----------------------------------------------------*\
    | Stop all running tasks before the plugin unloads.     |
    | Each ScheduledTask::Stop() joins and destroys its     |
    | worker thread so no task can trigger (e.g. load a     |
    | profile) after the plugin DLL has been unloaded.      |
    \*-----------------------------------------------------*/
    if(ui != nullptr)
    {
        ui->StopAllTasks();

        /*-------------------------------------------------*\
        | Destroy the whole view. All ScheduledTask widgets |
        | are children of the tabs widget, so they are      |
        | properly destroyed through Qt's parent-child      |
        | ownership.                                        |
        \*-------------------------------------------------*/
        delete ui;
        ui = nullptr;
    }
}

void OpenRGBSchedulerPlugin::OnProfileAboutToLoad()
{

}

void OpenRGBSchedulerPlugin::OnProfileLoad(nlohmann::json /*profile_data*/)
{

}

nlohmann::json OpenRGBSchedulerPlugin::OnProfileSave()
{
    nlohmann::json profile_json;

    return(profile_json);
}

#include "../LumenProtocol.h"
unsigned char* OpenRGBSchedulerPlugin::OnSDKCommand(unsigned int pkt_id, unsigned char* data, unsigned int* data_size)
{
    return lumen::Reply(pkt_id,data,data_size,[&](const lumen::json& r){return ui->LumenCommand(r);});
}

/*---------------------------------------------------------*\
| Update Signals                                            |
\*---------------------------------------------------------*/
void OpenRGBSchedulerPlugin::ProfileManagerUpdated(unsigned int update_reason)
{
    /*-----------------------------------------------------*\
    | When the profile list changes (e.g. a profile is      |
    | created, deleted, or renamed), refresh the profile    |
    | list shown in every scheduled task so the tasks always|
    | reflect the current set of available profiles.        |
    \*-----------------------------------------------------*/
    if(update_reason == PROFILEMANAGER_UPDATE_REASON_PROFILE_LIST_UPDATED)
    {
        if(ui != nullptr)
        {
            ui->UpdateProfileList();
        }
    }
}

void OpenRGBSchedulerPlugin::ResourceManagerUpdated(unsigned int /*update_reason*/)
{

}

void OpenRGBSchedulerPlugin::SettingsManagerUpdated(unsigned int /*update_reason*/)
{

}
