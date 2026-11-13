/*---------------------------------------------------------*\
| OpenRGBSchedulerPlugin.h                                  |
|                                                           |
|   OpenRGB Scheduler Plugin                                |
|                                                           |
|   This file is part of the OpenRGB Scheduler Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#pragma once

#include <QObject>
#include <QtPlugin>
#include <QString>
#include <QWidget>
#include "LogManager.h"
#include "OpenRGBPluginInterface.h"
#include "SchedulerMainView.h"

class OpenRGBSchedulerPlugin : public QObject, public OpenRGBPluginInterface
{
    Q_OBJECT
    Q_PLUGIN_METADATA(IID OpenRGBPluginInterface_IID FILE "OpenRGBSchedulerPlugin.json")
    Q_INTERFACES(OpenRGBPluginInterface)

public:
    OpenRGBSchedulerPlugin();
    ~OpenRGBSchedulerPlugin();

    /*-----------------------------------------------------*\
    | Plugin Information                                    |
    \*-----------------------------------------------------*/
    OpenRGBPluginInfo               GetPluginInfo();
    unsigned int                    GetPluginAPIVersion();

    /*-----------------------------------------------------*\
    | Plugin Functionality                                  |
    \*-----------------------------------------------------*/
    void                            Load(OpenRGBPluginAPIInterface* plugin_api_ptr);
    QWidget*                        GetWidget();
    QMenu*                          GetTrayMenu();
    void                            Unload();
    void                            OnProfileAboutToLoad();
    void                            OnProfileLoad(nlohmann::json profile_data);
    nlohmann::json                  OnProfileSave();
    unsigned char*                  OnSDKCommand(unsigned int pkt_id, unsigned char * pkt_data, unsigned int *pkt_size);

    /*-----------------------------------------------------*\
    | Update Signals                                        |
    \*-----------------------------------------------------*/
    void                            ProfileManagerUpdated(unsigned int update_reason);
    void                            ResourceManagerUpdated(unsigned int update_reason);
    void                            SettingsManagerUpdated(unsigned int update_reason);

private:
    /*-----------------------------------------------------*\
    | User interface widget                                 |
    \*-----------------------------------------------------*/
    SchedulerMainView*              ui;

public:
    /*-----------------------------------------------------*\
    | Plugin Global Variables                               |
    \*-----------------------------------------------------*/
    static OpenRGBPluginAPIInterface *  api;
};

/*---------------------------------------------------------*\
| LogManager logging macros                                 |
\*---------------------------------------------------------*/
#undef  LogAppend
#define LogAppend(level, ...)   OpenRGBSchedulerPlugin::api->LogEntry(__FILE__, __LINE__, level, __VA_ARGS__)