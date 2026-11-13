/*---------------------------------------------------------*\
| OpenRGBE131ReceiverPlugin.h                               |
|                                                           |
|   OpenRGB E1.31 Receiver Plugin                           |
|                                                           |
|   Adam Honse <calcprogrammer1@gmail.com>      05 Jan 2021 |
|                                                           |
|   This file is part of the OpenRGB E1.31 Receiver Plugin  |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#pragma once

#include <QObject>
#include <QString>
#include <QtPlugin>
#include <QWidget>
#include <QLabel>
#include "LogManager.h"
#include "OpenRGBE131ReceiverDialog.h"
#include "OpenRGBPluginInterface.h"
#include "ResourceManagerCallback.h"

class OpenRGBE131ReceiverPlugin : public QObject, public OpenRGBPluginInterface
{
    Q_OBJECT
    Q_PLUGIN_METADATA(IID OpenRGBPluginInterface_IID FILE "OpenRGBE131ReceiverPlugin.json")
    Q_INTERFACES(OpenRGBPluginInterface)

public:
    virtual                    ~OpenRGBE131ReceiverPlugin() {}

    /*-----------------------------------------------------*\
    | Plugin Information                                    |
    \*-----------------------------------------------------*/
    virtual OpenRGBPluginInfo   GetPluginInfo()                                                     override;
    virtual unsigned int        GetPluginAPIVersion()                                               override;

    /*-----------------------------------------------------*\
    | Plugin Functionality                                  |
    \*-----------------------------------------------------*/
    virtual void                Load(OpenRGBPluginAPIInterface* api_interface_ptr)                  override;
    virtual QWidget*            GetWidget()                                                         override;
    virtual QMenu*              GetTrayMenu()                                                       override;
    virtual void                Unload()                                                            override;
    virtual void                OnProfileAboutToLoad()                                              override;
    virtual void                OnProfileLoad(nlohmann::json profile_data)                          override;
    virtual nlohmann::json      OnProfileSave()                                                     override;
    virtual unsigned char*      OnSDKCommand(unsigned int pkt_id, unsigned char * pkt_data, unsigned int *pkt_size) override;

    /*-----------------------------------------------------*\
    | Update Signals                                        |
    \*-----------------------------------------------------*/
    void                        ProfileManagerUpdated(unsigned int update_reason)                   override;
    void                        ResourceManagerUpdated(unsigned int update_reason)                  override;
    void                        SettingsManagerUpdated(unsigned int update_reason)                  override;

private:
    OpenRGBE131ReceiverDialog * dialog = nullptr;

public:
    /*-----------------------------------------------------*\
    | Plugin Global Variables                               |
    \*-----------------------------------------------------*/
    static OpenRGBPluginAPIInterface* api;
};

/*---------------------------------------------------------*\
| LogManager logging macros                                 |
\*---------------------------------------------------------*/
#undef  LogAppend
#define LogAppend(level, ...)   OpenRGBE131ReceiverPlugin::api->LogEntry(__FILE__, __LINE__, level, __VA_ARGS__)
