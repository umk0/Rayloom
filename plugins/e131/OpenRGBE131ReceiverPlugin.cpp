/*---------------------------------------------------------*\
| OpenRGBE131ReceiverPlugin.cpp                             |
|                                                           |
|   OpenRGB E1.31 Receiver Plugin                           |
|                                                           |
|   Adam Honse <calcprogrammer1@gmail.com>      05 Jan 2021 |
|                                                           |
|   This file is part of the OpenRGB E1.31 Receiver Plugin  |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#include "OpenRGBE131ReceiverPlugin.h"
#include "OpenRGBE131ReceiverDialog.h"

/*---------------------------------------------------------*\
| Plugin Global Variables                                   |
\*---------------------------------------------------------*/
OpenRGBPluginAPIInterface* OpenRGBE131ReceiverPlugin::api = nullptr;

OpenRGBPluginInfo OpenRGBE131ReceiverPlugin::GetPluginInfo()
{
    OpenRGBPluginInfo info;

    info.Name               = PROJECT_NAME;
    info.Description        = PROJECT_DESC;
    info.Version            = VERSION_STRING;
    info.Commit             = GIT_COMMIT_ID;
    info.URL                = PROJECT_URL;

    info.Location           = OPENRGB_PLUGIN_LOCATION_TOP;
    info.Label              = "E1.31 Receiver";
    info.TabIcon.load(":/OpenRGBE131ReceiverPlugin.png");
    info.Icon.load(":/OpenRGBE131ReceiverPlugin.png");
    info.ProtocolVersion    = 0;

    return(info);
}

unsigned int OpenRGBE131ReceiverPlugin::GetPluginAPIVersion()
{
    return(OPENRGB_PLUGIN_API_VERSION);
}

void OpenRGBE131ReceiverPlugin::Load(OpenRGBPluginAPIInterface* api_interface_ptr)
{
    /*-----------------------------------------------------*\
    | Save the arguments to Initialize based on what you    |
    | need for this plugin's functionality.  In this example|
    | we will need the Resource Manager to access the device|
    | list, so save the Resource Manager pointer locally.   |
    \*-----------------------------------------------------*/
    api = api_interface_ptr;
}

QWidget* OpenRGBE131ReceiverPlugin::GetWidget()
{
    /*-----------------------------------------------------*\
    | Create the main widget for this plugin tab            |
    \*-----------------------------------------------------*/
    if(!dialog)dialog = new OpenRGBE131ReceiverDialog();

    /*-----------------------------------------------------*\
    | The CreateGUI function must return the main widget    |
    \*-----------------------------------------------------*/
    return dialog;
}

QMenu* OpenRGBE131ReceiverPlugin::GetTrayMenu()
{
    return(nullptr);
}

void OpenRGBE131ReceiverPlugin::Unload()
{
    delete dialog;dialog=nullptr;
}

void OpenRGBE131ReceiverPlugin::OnProfileAboutToLoad()
{

}

void OpenRGBE131ReceiverPlugin::OnProfileLoad(nlohmann::json /*profile_data*/)
{

}

nlohmann::json OpenRGBE131ReceiverPlugin::OnProfileSave()
{
    nlohmann::json profile_json;

    return(profile_json);
}

#include "../LumenProtocol.h"
unsigned char* OpenRGBE131ReceiverPlugin::OnSDKCommand(unsigned int pkt_id, unsigned char * pkt_data, unsigned int * pkt_size)
{
    return lumen::Reply(pkt_id,pkt_data,pkt_size,[&](const lumen::json& r){if(!dialog)GetWidget();return dialog->LumenCommand(r);});
}

void OpenRGBE131ReceiverPlugin::ProfileManagerUpdated(unsigned int /*update_reason*/)
{

}

void OpenRGBE131ReceiverPlugin::ResourceManagerUpdated(unsigned int update_reason)
{
    if(dialog)dialog->ResourceManagerUpdated(update_reason);
}

void OpenRGBE131ReceiverPlugin::SettingsManagerUpdated(unsigned int /*update_reason*/)
{
    
}
