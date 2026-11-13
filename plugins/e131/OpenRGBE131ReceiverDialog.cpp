/*---------------------------------------------------------*\
| OpenRGBE131ReceiverDialog.cpp                             |
|                                                           |
|   OpenRGB E1.31 Receiver Plugin Dialog                    |
|                                                           |
|   Adam Honse <calcprogrammer1@gmail.com>      05 Jan 2021 |
|                                                           |
|   This file is part of the OpenRGB E1.31 Receiver Plugin  |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#include <fstream>
#include <QDir>
#include <QLineEdit>
#include <QMessageBox>
#include <QSignalMapper>
#include <QThread>
#include "../LumenProtocol.h"
#include <e131.h>
#include <nlohmann/json.hpp>
#include "OpenRGBE131ReceiverDialog.h"
#include "OpenRGBE131ReceiverPlugin.h"
#include "ui_OpenRGBE131ReceiverDialog.h"
#include "RGBControllerInterface.h"

#ifndef _WIN32
#include <unistd.h>
#define closesocket ::close
#endif

#define MAX_LEDS_PER_UNIVERSE  170

using json = nlohmann::json;

typedef struct
{
    RGBControllerInterface*         controller;
    unsigned int                    start_channel;
    unsigned int                    start_led;
    unsigned int                    num_leds;
    bool                            update;
} universe_member;

typedef struct
{
    unsigned int                    universe;
    std::vector<universe_member>    members;
} universe_entry;

static std::vector<universe_entry> universe_list;

typedef unsigned int LineEditParameter;
enum
{
    LINEEDIT_PARAMETER_START_CHANNEL,
    LINEEDIT_PARAMETER_START_LED,
    LINEEDIT_PARAMETER_NUM_LEDS
};

class LineEditArgument : public QObject
{
public:
    QWidget *           widget;
    unsigned int        universe_idx;
    unsigned int        member_idx;
    LineEditParameter   parameter;
};

typedef unsigned int CheckBoxParameter;
enum
{
    CHECKBOX_PARAMETER_UPDATE
};

class CheckBoxArgument : public QObject
{
public:
    QWidget *           widget;
    unsigned int        universe_idx;
    unsigned int        member_idx;
    CheckBoxParameter   parameter;
};

OpenRGBE131ReceiverDialog::OpenRGBE131ReceiverDialog(QWidget *parent) : QWidget(parent), ui(new Ui::OpenRGBE131ReceiverDialog)
{
    /*-------------------------------------------------*\
    | Set up UI                                         |
    \*-------------------------------------------------*/
    ui->setupUi(this);

    /*-------------------------------------------------*\
    | Initialize variables                              |
    \*-------------------------------------------------*/
    online         = false;
    initialized    = false;
    received_count = 0;

    /*-------------------------------------------------*\
    | Initialize the device list                        |
    \*-------------------------------------------------*/
    DeviceListChanged();

    /*-------------------------------------------------*\
    | Initialize the online status                      |
    \*-------------------------------------------------*/
    UpdateOnlineStatus();
}

OpenRGBE131ReceiverDialog::~OpenRGBE131ReceiverDialog()
{
    on_ButtonStopReceiver_clicked();
    delete ui;
}

void OpenRGBE131ReceiverDialog::DeviceListChanged()
{
    const bool restart = online.load();
    on_ButtonStopReceiver_clicked();
    /*-------------------------------------------------*\
    | Lock the controllers mutex                        |
    \*-------------------------------------------------*/
    controller_mutex.lock();

    /*-------------------------------------------------*\
    | Clear the lists                                   |
    \*-------------------------------------------------*/
    ui->ControllersTreeView->clear();
    ui->E131TreeView->clear();
    universe_list.clear();

    /*-------------------------------------------------*\
    | Update the controllers list                       |
    \*-------------------------------------------------*/
    UpdateControllersTreeView();

    /*-------------------------------------------------*\
    | Unlock the controllers mutex                      |
    \*-------------------------------------------------*/
    controller_mutex.unlock();
    
    /*-------------------------------------------------*\
    | Reload the map                                    |
    \*-------------------------------------------------*/
    LoadMap();
    if(restart) StartReceiver();

    /*-------------------------------------------------*\
    | Check autostart                                   |
    \*-------------------------------------------------*/
    if(!initialized)
    {
        if(ui->EnableAutoStartBox->checkState() == Qt::Checked)
        {
            this->StartReceiver();
        }
        initialized = true;
    }
}

void OpenRGBE131ReceiverDialog::UpdateControllersTreeView()
{
    ui->ControllersTreeView->clear();

    ui->ControllersTreeView->setColumnCount(1);
    ui->ControllersTreeView->setHeaderLabels(QStringList() << "Controller");

    for(unsigned int controller_idx = 0; controller_idx < OpenRGBE131ReceiverPlugin::api->GetRGBControllers().size(); controller_idx++)
    {
        RGBControllerInterface* controller              = OpenRGBE131ReceiverPlugin::api->GetRGBControllers()[controller_idx];
        QTreeWidgetItem*        new_controller_entry    = new QTreeWidgetItem(ui->ControllersTreeView);

        new_controller_entry->setText(0, QString::fromStdString(controller->GetName()));
    }
}

void OpenRGBE131ReceiverDialog::UpdateTreeView()
{
    ui->E131TreeView->clear();

    ui->E131TreeView->setColumnCount(5);
    ui->E131TreeView->header()->setStretchLastSection(false);
    ui->E131TreeView->header()->setSectionResizeMode(0, QHeaderView::Stretch);
    ui->E131TreeView->setHeaderLabels(QStringList() << "Universe" << "Start Channel" << "Start LED" << "LED Count" << "Update");

    /*-----------------------------------------------------*\
    | Create a signal mapper for LineEdit fields            |
    \*-----------------------------------------------------*/
    QSignalMapper* LineEditMapper = new QSignalMapper(this);
    connect(LineEditMapper, SIGNAL(mappedObject(QObject *)), this, SLOT(LineEdit_updated_slot(QObject *)));

    /*-----------------------------------------------------*\
    | Create a signal mapper for CheckBox fields            |
    \*-----------------------------------------------------*/
    QSignalMapper* CheckBoxMapper = new QSignalMapper(this);
    connect(CheckBoxMapper, SIGNAL(mappedObject(QObject *)), this, SLOT(CheckBox_updated_slot(QObject *)));

    for(unsigned int universe_idx = 0; universe_idx < universe_list.size(); universe_idx++)
    {
        QTreeWidgetItem* new_universe_entry = new QTreeWidgetItem(ui->E131TreeView);

        new_universe_entry->setText(0, QString::fromStdString("Universe " + std::to_string(universe_list[universe_idx].universe)));

        for(unsigned int member_idx = 0; member_idx < universe_list[universe_idx].members.size(); member_idx++)
        {
            QTreeWidgetItem* new_member_entry = new QTreeWidgetItem(new_universe_entry);

            new_member_entry->setText(0, QString::fromStdString((universe_list[universe_idx].members[member_idx].controller->GetName())));

            QLineEdit* start_channel_edit = new QLineEdit(ui->E131TreeView);
            start_channel_edit->setText(QString::number(universe_list[universe_idx].members[member_idx].start_channel));
            ui->E131TreeView->setItemWidget(new_member_entry, 1, start_channel_edit);

            LineEditArgument* start_channel_argument = new LineEditArgument();

            start_channel_argument->widget          = start_channel_edit;
            start_channel_argument->universe_idx    = universe_idx;
            start_channel_argument->member_idx      = member_idx;
            start_channel_argument->parameter       = LINEEDIT_PARAMETER_START_CHANNEL;

            connect(start_channel_edit, SIGNAL(editingFinished()), LineEditMapper, SLOT(map()));
            LineEditMapper->setMapping(start_channel_edit, start_channel_argument);

            QLineEdit* start_led_edit = new QLineEdit(ui->E131TreeView);
            start_led_edit->setText(QString::number(universe_list[universe_idx].members[member_idx].start_led));
            ui->E131TreeView->setItemWidget(new_member_entry, 2, start_led_edit);

            LineEditArgument* start_led_argument = new LineEditArgument();

            start_led_argument->widget          = start_led_edit;
            start_led_argument->universe_idx    = universe_idx;
            start_led_argument->member_idx      = member_idx;
            start_led_argument->parameter       = LINEEDIT_PARAMETER_START_LED;

            connect(start_led_edit, SIGNAL(editingFinished()), LineEditMapper, SLOT(map()));
            LineEditMapper->setMapping(start_led_edit, start_led_argument);

            QLineEdit* num_leds_edit = new QLineEdit(ui->E131TreeView);
            num_leds_edit->setText(QString::number(universe_list[universe_idx].members[member_idx].num_leds));
            ui->E131TreeView->setItemWidget(new_member_entry, 3, num_leds_edit);

            LineEditArgument* num_leds_argument = new LineEditArgument();

            num_leds_argument->widget           = num_leds_edit;
            num_leds_argument->universe_idx     = universe_idx;
            num_leds_argument->member_idx       = member_idx;
            num_leds_argument->parameter        = LINEEDIT_PARAMETER_NUM_LEDS;

            connect(num_leds_edit, SIGNAL(editingFinished()), LineEditMapper, SLOT(map()));
            LineEditMapper->setMapping(num_leds_edit, num_leds_argument);

            QCheckBox* update_checkbox = new QCheckBox(ui->E131TreeView);
            update_checkbox->setChecked(universe_list[universe_idx].members[member_idx].update);
            ui->E131TreeView->setItemWidget(new_member_entry, 4, update_checkbox);

            CheckBoxArgument*   update_argument = new CheckBoxArgument();

            update_argument->widget             = update_checkbox;
            update_argument->universe_idx       = universe_idx;
            update_argument->member_idx         = member_idx;
            update_argument->parameter          = CHECKBOX_PARAMETER_UPDATE;

            connect(update_checkbox, SIGNAL(clicked()), CheckBoxMapper, SLOT(map()));
            CheckBoxMapper->setMapping(update_checkbox, update_argument);
        }
    }

    ui->E131TreeView->setStyleSheet("QLineEdit { border: none }");

    ui->E131TreeView->expandAll();
}

void OpenRGBE131ReceiverDialog::AutoMap()
{
    for(unsigned int controller_idx = 0; controller_idx < OpenRGBE131ReceiverPlugin::api->GetRGBControllers().size(); controller_idx++)
    {
        RGBControllerInterface* controller      = OpenRGBE131ReceiverPlugin::api->GetRGBControllers()[controller_idx];

        // Determine if the controller has a Direct mode
        bool has_direct = false;
        for(unsigned int mode_idx = 0; mode_idx < controller->GetModeCount(); mode_idx++)
        {
            if(controller->GetModeName(mode_idx) == "Direct")
            {
                has_direct = true;
                break;
            }
        }

        // Only map controllers that have a Direct mode
        if(has_direct)
        {
            unsigned int num_universes  = 1 + ((controller->GetLEDCount() * 3) / 512);
            unsigned int remaining_leds = controller->GetLEDCount();
            unsigned int start_led      = 0;

            for(unsigned int universe_idx = 0; universe_idx < num_universes; universe_idx++)
            {
                // For now, create universes sequentially per controller
                universe_entry new_entry;

                new_entry.universe = universe_list.size() + 1;

                // Add members as needed
                universe_member new_member;

                new_member.controller    = OpenRGBE131ReceiverPlugin::api->GetRGBControllers()[controller_idx];
                new_member.start_channel = 1;
                new_member.start_led     = start_led;
                new_member.num_leds      = remaining_leds;
                new_member.update        = false;

                // Limit the number of LEDs
                if(new_member.num_leds > MAX_LEDS_PER_UNIVERSE)
                {
                    new_member.num_leds  = MAX_LEDS_PER_UNIVERSE;
                }

                // Update start LED
                start_led                = start_led + new_member.num_leds;

                // Update remaining LED count
                remaining_leds           = remaining_leds - new_member.num_leds;

                // Only set the update flag for the last universe of the controller
                if(universe_idx == (num_universes - 1))
                {
                    new_member.update   = true;
                }

                new_entry.members.push_back(new_member);

                universe_list.push_back(new_entry);
            }
        }
    }
}

void OpenRGBE131ReceiverDialog::E131ReceiverThreadFunction()
{
    /*-----------------------------------------------------*\
    | Local variables                                       |
    \*-----------------------------------------------------*/
    int             sockfd;
    e131_packet_t   packet;
    e131_error_t    error;
    std::chrono::time_point<std::chrono::steady_clock>  last_update_time;

    /*-----------------------------------------------------*\
    | Initialize update time                                |
    \*-----------------------------------------------------*/
    last_update_time = std::chrono::steady_clock::now();

    /*-----------------------------------------------------*\
    | Clear online status                                   |
    \*-----------------------------------------------------*/
    /*-----------------------------------------------------*\
    | Create a socket for E1.31                             |
    \*-----------------------------------------------------*/
    sockfd = e131_socket();

    if(sockfd < 0)
    {
        LOG_ERROR("[OpenRGBE131ReceiverPlugin] Socket error");
        online=false;
        return;
    }

    /*-----------------------------------------------------*\
    | Bind the socket to the default E1.31 port             |
    \*-----------------------------------------------------*/
    if(e131_bind(sockfd, E131_DEFAULT_PORT) < 0)
    {
        LOG_ERROR("[OpenRGBE131ReceiverPlugin] Bind error");
        closesocket(sockfd);online=false;
        return;
    }

    /*-----------------------------------------------------*\
    | Join the configured universes if multicast enabled    |
    \*-----------------------------------------------------*/
    bool multicast = ui->EnableMulticastBox->checkState() == Qt::Checked;

    for(unsigned int universe_idx = 0; universe_idx < universe_list.size(); universe_idx++)
    {
        if(multicast)
        {
            if(e131_multicast_join(sockfd, universe_list[universe_idx].universe) < 0)
            {
                LOG_ERROR("[OpenRGBE131ReceiverPlugin] Join error");
                closesocket(sockfd);online=false;
                return;
            }
        }
    }

    /*-----------------------------------------------------*\
    | Set online status                                     |
    \*-----------------------------------------------------*/
    // StartReceiver owns the running flag; do not undo a concurrent stop.

    /*-----------------------------------------------------*\
    | Loop to receive E1.31 packets                         |
    \*-----------------------------------------------------*/
    while(online)
    {
        fd_set readable;FD_ZERO(&readable);FD_SET(sockfd,&readable);timeval timeout{0,200000};
        if(select(sockfd+1,&readable,nullptr,nullptr,&timeout)<=0)continue;
        packet = {};
        auto bytes = e131_recv(sockfd, &packet);
        if(bytes < 0)
        {
            LOG_ERROR("[OpenRGBE131ReceiverPlugin] Receive error");

            online = false;
            break;
        }
        const auto propertyCount = ntohs(packet.dmp.prop_val_cnt);
        if(propertyCount < 1 || propertyCount > 513 || bytes < static_cast<decltype(bytes)>(offsetof(e131_packet_t,dmp.prop_val) + propertyCount) || packet.dmp.prop_val[0] != 0) continue;

        if((error = e131_pkt_validate(&packet)) != E131_ERR_NONE)
        {
            LOG_ERROR("[OpenRGBE131ReceiverPlugin] Validation error: %s", e131_strerror(error));
            continue;
        }

        received_count++;

        if((std::chrono::steady_clock::now() - last_update_time) > std::chrono::milliseconds(500))
        {
            auto count=received_count.load();auto source=QString::fromLocal8Bit((const char *)packet.frame.source_name,64);
            QMetaObject::invokeMethod(this,[this,count,source](){ui->PacketsReceivedValue->setText(QString::number(count));ui->ReceiverSourceValue->setText(source);},Qt::QueuedConnection);

            last_update_time = std::chrono::steady_clock::now();
        }

        /*-------------------------------------------------*\
        | If received packet is from a valid universe,      |
        | update the corresponding devices                  |
        \*-------------------------------------------------*/
        unsigned int universe = ntohs(packet.frame.universe);

        for(unsigned int universe_idx = 0; universe_idx < universe_list.size(); universe_idx++)
        {
            if(universe_list[universe_idx].universe == universe)
            {
                for(unsigned int member_idx = 0; member_idx < universe_list[universe_idx].members.size(); member_idx++)
                {
                    RGBControllerInterface*  controller  = universe_list[universe_idx].members[member_idx].controller;
                    unsigned int    channel     = universe_list[universe_idx].members[member_idx].start_channel;
                    unsigned int    start_led   = universe_list[universe_idx].members[member_idx].start_led;
                    unsigned int    num_leds    = universe_list[universe_idx].members[member_idx].num_leds;
                    bool            update      = universe_list[universe_idx].members[member_idx].update;

                    // Channel range is 1-512, so break if channel is zero
                    if(channel == 0)
                    {
                        break;
                    }

                    controller_mutex.lock_shared();

                    for(unsigned int led_idx = start_led; led_idx < (start_led + num_leds); led_idx++)
                    {
                        // Calculate channels for this LED
                        unsigned int red_idx    = channel + 0;
                        unsigned int grn_idx    = channel + 1;
                        unsigned int blu_idx    = channel + 2;

                        // Verify last channel (blue) is within range 1-512
                        if(blu_idx > 512 || blu_idx >= propertyCount)
                        {
                            break;
                        }

                        // Get color out of E1.31 packet
                        RGBColor led_color      = ToRGBColor(packet.dmp.prop_val[red_idx],
                                                             packet.dmp.prop_val[grn_idx],
                                                             packet.dmp.prop_val[blu_idx]);

                        // Verify LED index
                        if(led_idx >= controller->GetLEDCount())
                        {
                            break;
                        }

                        // Set LED color in controller
                        controller->SetColor(led_idx, led_color);

                        // Increment the channel by 3 to account for red, green, and blue channels
                        channel = channel + 3;
                    }

                    // If configured to update the device, update
                    if(update)
                    {
                        controller->UpdateLEDs();
                    }

                    controller_mutex.unlock_shared();
                }
            }
        }
    }

    closesocket(sockfd);

    QMetaObject::invokeMethod(this,[this](){UpdateOnlineStatus();},Qt::QueuedConnection);
}

void OpenRGBE131ReceiverDialog::ResourceManagerUpdated(unsigned int update_reason)
{
    switch(update_reason)
    {
        case RESOURCEMANAGER_UPDATE_REASON_DEVICE_LIST_UPDATED:
            {
            if(QThread::currentThread()==thread())DeviceListChanged();else QMetaObject::invokeMethod(this, "DeviceListChanged", Qt::BlockingQueuedConnection);
            }
            break;
    }
}

void OpenRGBE131ReceiverDialog::UpdateOnlineStatus()
{
    if(online)
    {
        ui->ReceiverStatusValue->setText("Online");

        ui->ButtonStartReceiver->setEnabled(false);
        ui->ButtonStopReceiver->setEnabled(true);
    }
    else
    {
        ui->ReceiverStatusValue->setText("Offline");

        received_count = 0;

        ui->PacketsReceivedValue->setText(QString::number(received_count.load()));

        ui->ButtonStartReceiver->setEnabled(true);
        ui->ButtonStopReceiver->setEnabled(false);
    }
}

void OpenRGBE131ReceiverDialog::LoadMap()
{
    /*-----------------------------------------------------*\
    | Read in the JSON map from a file                      |
    \*-----------------------------------------------------*/
    json universe_map;

    /*-----------------------------------------------------*\
    | Open input file in binary mode                        |
    \*-----------------------------------------------------*/
    std::ifstream universe_file(OpenRGBE131ReceiverPlugin::api->GetConfigurationDirectory() / "plugins" / "settings" / "E131UniverseMap.json", std::ios::in | std::ios::binary);

    /*-----------------------------------------------------*\
    | Read settings into JSON store                         |
    \*-----------------------------------------------------*/
    if(universe_file)
    {
        try
        {
            universe_file >> universe_map;
        }
        catch(std::exception &e)
        {
            /*---------------------------------------------*\
            | If an exception was caught, that means the    |
            | JSON parsing failed.  Clear out any data in   |
            | the store as it is corrupt.                   |
            \*---------------------------------------------*/
            universe_map.clear();
        }
    }

    /*-----------------------------------------------------*\
    | Load checkboxes state                                 |
    \*-----------------------------------------------------*/
    if(universe_map.contains("enable_multicast"))
    {
        if(universe_map["enable_multicast"])
        {
            ui->EnableMulticastBox->setCheckState(Qt::Checked);
        }
        else
        {
            ui->EnableMulticastBox->setCheckState(Qt::Unchecked);
        }
    }
    if(universe_map.contains("enable_autostart"))
    {
        if(universe_map["enable_autostart"])
        {
            ui->EnableAutoStartBox->setCheckState(Qt::Checked);
        }
        else
        {
            ui->EnableAutoStartBox->setCheckState(Qt::Unchecked);
        }
    }

    /*-----------------------------------------------------*\
    | Clear the universe map                                |
    \*-----------------------------------------------------*/
    universe_list.clear();

    /*-----------------------------------------------------*\
    | Loop through all saved universes and create list      |
    | entries                                               |
    \*-----------------------------------------------------*/
    if(universe_map.contains("universes"))
    {
        for(unsigned int universe_index = 0; universe_index < universe_map["universes"].size(); universe_index++)
        {
            if(universe_map["universes"][universe_index].contains("universe"))
            {
                universe_entry new_universe;

                new_universe.universe = universe_map["universes"][universe_index]["universe"];

                if(universe_map["universes"][universe_index].contains("members"))
                {
                    for(unsigned int member_index = 0; member_index < universe_map["universes"][universe_index]["members"].size(); member_index++)
                    {
                        universe_member new_member;

                        /*---------------------------------*\
                        | Fill in default values in case    |
                        | entries are missing               |
                        \*---------------------------------*/
                        new_member.controller       = NULL;
                        new_member.start_channel    = 1;
                        new_member.start_led        = 0;
                        new_member.num_leds         = 0;
                        new_member.update           = false;

                        if(universe_map["universes"][universe_index]["members"][member_index].contains("start_channel"))
                        {
                            new_member.start_channel = universe_map["universes"][universe_index]["members"][member_index]["start_channel"];
                        }

                        if(universe_map["universes"][universe_index]["members"][member_index].contains("start_led"))
                        {
                            new_member.start_led = universe_map["universes"][universe_index]["members"][member_index]["start_led"];
                        }

                        if(universe_map["universes"][universe_index]["members"][member_index].contains("num_leds"))
                        {
                            new_member.num_leds = universe_map["universes"][universe_index]["members"][member_index]["num_leds"];
                        }

                        if(universe_map["universes"][universe_index]["members"][member_index].contains("update"))
                        {
                            new_member.update = universe_map["universes"][universe_index]["members"][member_index]["update"];
                        }

                        /*---------------------------------*\
                        | Get controller information        |
                        \*---------------------------------*/
                        std::string controller_name         = "";
                        std::string controller_description  = "";
                        std::string controller_location     = "";
                        std::string controller_serial       = "";
                        unsigned int controller_led_count   = 0;

                        if(universe_map["universes"][universe_index]["members"][member_index].contains("controller_name"))
                        {
                            controller_name = universe_map["universes"][universe_index]["members"][member_index]["controller_name"];
                        }

                        if(universe_map["universes"][universe_index]["members"][member_index].contains("controller_description"))
                        {
                            controller_description = universe_map["universes"][universe_index]["members"][member_index]["controller_description"];
                        }

                        if(universe_map["universes"][universe_index]["members"][member_index].contains("controller_location"))
                        {
                            controller_location = universe_map["universes"][universe_index]["members"][member_index]["controller_location"];
                        }

                        if(universe_map["universes"][universe_index]["members"][member_index].contains("controller_serial"))
                        {
                            controller_serial = universe_map["universes"][universe_index]["members"][member_index]["controller_serial"];
                        }

                        if(universe_map["universes"][universe_index]["members"][member_index].contains("controller_led_count"))
                        {
                            controller_led_count = universe_map["universes"][universe_index]["members"][member_index]["controller_led_count"];
                        }

                        /*---------------------------------*\
                        | Search the controller list for a  |
                        | matching controller               |
                        \*---------------------------------*/
                        for(unsigned int controller_index = 0; controller_index < OpenRGBE131ReceiverPlugin::api->GetRGBControllers().size(); controller_index++)
                        {
                            /*-----------------------------*\
                            | Do not compare location       |
                            | string for HID devices, as    |
                            | the location string may       |
                            | change between runs.          |
                            \*-----------------------------*/
                            bool location_check;

                            if(OpenRGBE131ReceiverPlugin::api->GetRGBControllers()[controller_index]->GetLocation().find("HID: ") == 0)
                            {
                                location_check = true;
                            }
                            else
                            {
                                location_check = controller_location == OpenRGBE131ReceiverPlugin::api->GetRGBControllers()[controller_index]->GetLocation();
                            }
                            if((OpenRGBE131ReceiverPlugin::api->GetRGBControllers()[controller_index]->GetName()          == controller_name)
                            && (OpenRGBE131ReceiverPlugin::api->GetRGBControllers()[controller_index]->GetDescription()   == controller_description)
                            && (OpenRGBE131ReceiverPlugin::api->GetRGBControllers()[controller_index]->GetSerial()        == controller_serial)
                            && (OpenRGBE131ReceiverPlugin::api->GetRGBControllers()[controller_index]->GetLEDCount()      == controller_led_count)
                            && (location_check                                                              == true))
                            {
                                new_member.controller = OpenRGBE131ReceiverPlugin::api->GetRGBControllers()[controller_index];
                            }
                        }

                        /*---------------------------------*\
                        | If a controller was found, add    |
                        | the member to the universe        |
                        \*---------------------------------*/
                        if(new_member.controller != NULL)
                        {
                            new_universe.members.push_back(new_member);
                        }
                    }
                }

                universe_list.push_back(new_universe);
            }
        }
    }

    /*-----------------------------------------------------*\
    | Update the universe tree view                         |
    \*-----------------------------------------------------*/
    UpdateTreeView();
}

void OpenRGBE131ReceiverDialog::StartReceiver()
{
    if(!online)
    {
        if(E131ReceiverThread){E131ReceiverThread->join();delete E131ReceiverThread;E131ReceiverThread=nullptr;}
        online=true;
        /*-------------------------------------------------*\
        | Start the receiver thread                         |
        \*-------------------------------------------------*/
        E131ReceiverThread = new std::thread(&OpenRGBE131ReceiverDialog::E131ReceiverThreadFunction, this);
    }
}

void OpenRGBE131ReceiverDialog::on_ButtonStartReceiver_clicked()
{
    StartReceiver();
}

void OpenRGBE131ReceiverDialog::on_ButtonStopReceiver_clicked()
{
    online = false;
    if(E131ReceiverThread){E131ReceiverThread->join();delete E131ReceiverThread;E131ReceiverThread=nullptr;}

    UpdateOnlineStatus();
}

void OpenRGBE131ReceiverDialog::LineEdit_updated_slot(QObject* lineedit_argument)
{
    /*-----------------------------------------------------*\
    | Update the parameter                                  |
    \*-----------------------------------------------------*/
    unsigned int universe_idx   = ((LineEditArgument*)lineedit_argument)->universe_idx;
    unsigned int member_idx     = ((LineEditArgument*)lineedit_argument)->member_idx;
    LineEditParameter parameter = ((LineEditArgument*)lineedit_argument)->parameter;
    QWidget* widget             = ((LineEditArgument*)lineedit_argument)->widget;

    unsigned int value          = ((QLineEdit*)widget)->text().toInt();

    switch(parameter)
    {
        case LINEEDIT_PARAMETER_START_CHANNEL:
            universe_list[universe_idx].members[member_idx].start_channel = value;
            break;

        case LINEEDIT_PARAMETER_START_LED:
            universe_list[universe_idx].members[member_idx].start_led = value;
            break;

        case LINEEDIT_PARAMETER_NUM_LEDS:
            universe_list[universe_idx].members[member_idx].num_leds = value;
            break;
    }
}

void OpenRGBE131ReceiverDialog::CheckBox_updated_slot(QObject* checkbox_argument)
{
    /*-----------------------------------------------------*\
    | Update the parameter                                  |
    \*-----------------------------------------------------*/
    unsigned int universe_idx   = ((CheckBoxArgument*)checkbox_argument)->universe_idx;
    unsigned int member_idx     = ((CheckBoxArgument*)checkbox_argument)->member_idx;
    CheckBoxParameter parameter = ((CheckBoxArgument*)checkbox_argument)->parameter;
    QWidget* widget             = ((CheckBoxArgument*)checkbox_argument)->widget;

    bool value                  = ((QCheckBox*)widget)->isChecked();

    switch(parameter)
    {
        case CHECKBOX_PARAMETER_UPDATE:
            universe_list[universe_idx].members[member_idx].update = value;
            break;
    }
}

void OpenRGBE131ReceiverDialog::on_ButtonAddController_clicked()
{
    /*-----------------------------------------------------*\
    | Make sure a valid controller is selected on the left  |
    | and a valid universe is selected on the right         |
    \*-----------------------------------------------------*/
    int selected_controller = ui->ControllersTreeView->indexOfTopLevelItem(ui->ControllersTreeView->currentItem());
    int selected_universe   = ui->E131TreeView->indexOfTopLevelItem(ui->E131TreeView->currentItem());

    if((selected_controller == -1) || (selected_universe == -1))
    {
        return;
    }

    /*-----------------------------------------------------*\
    | Determine start channel                               |
    \*-----------------------------------------------------*/
    unsigned int start_channel  = 1;

    if(universe_list[selected_universe].members.size() > 0)
    {
        universe_member last_member = universe_list[selected_universe].members[universe_list[selected_universe].members.size() - 1];
        start_channel               = last_member.start_channel + (last_member.num_leds * 3);
    }

    /*-----------------------------------------------------*\
    | Determine number of LEDs                              |
    \*-----------------------------------------------------*/
    unsigned int start_led      = 0;
    unsigned int num_leds       = OpenRGBE131ReceiverPlugin::api->GetRGBControllers()[selected_controller]->GetLEDCount();
    unsigned int remaining_leds = num_leds;
    bool         update         = false;

    if((num_leds * 3) + start_channel > 512)
    {
        num_leds       = (512 - start_channel) / 3;
        remaining_leds -= num_leds;
        start_led      += num_leds;

        QMessageBox::StandardButton reply;

        reply = QMessageBox::question(this, "", "This controller is too large for the selected universe.  Do you want to map additional universes for this controller?", QMessageBox::Yes|QMessageBox::No);

        if(reply == QMessageBox::Yes)
        {
            update  = false;
        }
        else
        {
            update  = true;
        }
    }
    else
    {
        update = true;
    }

    /*-----------------------------------------------------*\
    | Add controller to universe                            |
    \*-----------------------------------------------------*/
    universe_member new_member;

    new_member.controller                   = OpenRGBE131ReceiverPlugin::api->GetRGBControllers()[selected_controller];
    new_member.start_channel                = start_channel;
    new_member.start_led                    = 0;
    new_member.num_leds                     = num_leds;

    new_member.update                       = update;

    universe_list[selected_universe].members.push_back(new_member);

    /*-----------------------------------------------------*\
    | Add additional universes for controller               |
    \*-----------------------------------------------------*/
    if(update == false)
    {
        while(remaining_leds > 0)
        {
            start_channel   = 1;
            num_leds        = remaining_leds;

            if((num_leds * 3) + start_channel > 512)
            {
                num_leds       = (512 - start_channel) / 3;
            }

            remaining_leds -= num_leds;

            if(remaining_leds == 0)
            {
                update          = true;
            }

            /*-----------------------------------------------------*\
            | Get next universe value                               |
            \*-----------------------------------------------------*/
            unsigned int next_universe = 1;

            if(universe_list.size() > 0)
            {
                next_universe = universe_list[universe_list.size() - 1].universe + 1;
            }

            /*-----------------------------------------------------*\
            | Create and add new universe to list                   |
            \*-----------------------------------------------------*/
            universe_entry new_universe;

            new_universe.universe = next_universe;

            /*-----------------------------------------------------*\
            | Add selected controller member to new universe        |
            \*-----------------------------------------------------*/
            universe_member new_member;

            new_member.controller                   = OpenRGBE131ReceiverPlugin::api->GetRGBControllers()[selected_controller];
            new_member.start_channel                = 1;
            new_member.start_led                    = start_led;
            new_member.num_leds                     = num_leds;
            new_member.update                       = update;

            new_universe.members.push_back(new_member);

            universe_list.push_back(new_universe);

            start_led += num_leds;
        }
    }

    /*-----------------------------------------------------*\
    | Update the universe tree view                         |
    \*-----------------------------------------------------*/
    UpdateTreeView();
}

void OpenRGBE131ReceiverDialog::on_ButtonRemoveController_clicked()
{
    /*-----------------------------------------------------*\
    | Make selected item is not a top-level (universe)      |
    \*-----------------------------------------------------*/
    int selected_controller = ui->E131TreeView->indexOfTopLevelItem(ui->E131TreeView->currentItem());

    if(selected_controller != -1)
    {
        return;
    }

    /*-----------------------------------------------------*\
    | Get index of universe member                          |
    \*-----------------------------------------------------*/
    selected_controller     = ui->E131TreeView->currentIndex().row();
    int selected_universe   = ui->E131TreeView->indexOfTopLevelItem(ui->E131TreeView->currentItem()->parent());

    if(selected_universe == -1)
    {
        return;
    }

    /*-----------------------------------------------------*\
    | Remove controller member from universe                |
    \*-----------------------------------------------------*/
    universe_list[selected_universe].members.erase(universe_list[selected_universe].members.begin() + selected_controller);

    /*-----------------------------------------------------*\
    | Update the universe tree view                         |
    \*-----------------------------------------------------*/
    UpdateTreeView();
}

void OpenRGBE131ReceiverDialog::on_ButtonAddUniverse_clicked()
{
    /*-----------------------------------------------------*\
    | Get next universe value                               |
    \*-----------------------------------------------------*/
    unsigned int next_universe = 1;

    if(universe_list.size() > 0)
    {
        next_universe = universe_list[universe_list.size() - 1].universe + 1;
    }

    /*-----------------------------------------------------*\
    | Create and add new universe to list                   |
    \*-----------------------------------------------------*/
    universe_entry new_universe;

    new_universe.universe = next_universe;

    universe_list.push_back(new_universe);

    /*-----------------------------------------------------*\
    | Update the universe tree view                         |
    \*-----------------------------------------------------*/
    UpdateTreeView();
}

void OpenRGBE131ReceiverDialog::on_ButtonRemoveUniverse_clicked()
{
    /*-----------------------------------------------------*\
    | Get index of universe                                 |
    \*-----------------------------------------------------*/
    int selected_universe   = ui->E131TreeView->indexOfTopLevelItem(ui->E131TreeView->currentItem());

    if(selected_universe == -1)
    {
        return;
    }

    /*-----------------------------------------------------*\
    | Remove universe                                       |
    \*-----------------------------------------------------*/
    universe_list.erase(universe_list.begin() + selected_universe);

    /*-----------------------------------------------------*\
    | Update the universe tree view                         |
    \*-----------------------------------------------------*/
    UpdateTreeView();
}

void OpenRGBE131ReceiverDialog::on_ButtonAutoMap_clicked()
{
    AutoMap();

    /*-----------------------------------------------------*\
    | Update the universe tree view                         |
    \*-----------------------------------------------------*/
    UpdateTreeView();
}

void OpenRGBE131ReceiverDialog::on_ButtonSaveMap_clicked()
{
    /*-----------------------------------------------------*\
    | Create a JSON structure to hold the universe map      |
    \*-----------------------------------------------------*/
    json universe_map;

    /*-----------------------------------------------------*\
    | Loop through the universe list and add universe fields|
    \*-----------------------------------------------------*/
    for(unsigned int universe_index = 0; universe_index < universe_list.size(); universe_index++)
    {
        universe_entry universe = universe_list[universe_index];

        universe_map["universes"][universe_index]["universe"] = universe.universe;

        /*-----------------------------------------------------*\
        | Loop through all members and add info fields          |
        \*-----------------------------------------------------*/
        for(unsigned int member_index = 0; member_index < universe.members.size(); member_index++)
        {
            universe_member member = universe.members[member_index];

            universe_map["universes"][universe_index]["members"][member_index]["start_channel"]             = member.start_channel;
            universe_map["universes"][universe_index]["members"][member_index]["start_led"]                 = member.start_led;
            universe_map["universes"][universe_index]["members"][member_index]["num_leds"]                  = member.num_leds;
            universe_map["universes"][universe_index]["members"][member_index]["update"]                    = member.update;
            universe_map["universes"][universe_index]["members"][member_index]["controller_name"]           = member.controller->GetName();
            universe_map["universes"][universe_index]["members"][member_index]["controller_description"]    = member.controller->GetDescription();
            universe_map["universes"][universe_index]["members"][member_index]["controller_location"]       = member.controller->GetLocation();
            universe_map["universes"][universe_index]["members"][member_index]["controller_serial"]         = member.controller->GetSerial();
            universe_map["universes"][universe_index]["members"][member_index]["controller_led_count"]      = member.controller->GetLEDCount();
        }
    }

    universe_map["enable_multicast"] = ui->EnableMulticastBox->checkState() == Qt::Checked;
    universe_map["enable_autostart"] = ui->EnableAutoStartBox->checkState() == Qt::Checked;

    /*-----------------------------------------------------*\
    | Write out the JSON structure to a file                |
    \*-----------------------------------------------------*/
    filesystem::path settings_dir = OpenRGBE131ReceiverPlugin::api->GetConfigurationDirectory() / "plugins" / "settings";

    if(!std::filesystem::is_directory(settings_dir) || !std::filesystem::exists(settings_dir))
    {
        std::filesystem::create_directories(settings_dir);
    }

    std::ofstream universe_file(settings_dir / "E131UniverseMap.json", std::ios::out | std::ios::binary);

    if(universe_file)
    {
        try
        {
            universe_file << universe_map.dump(4);
        }
        catch(std::exception &e)
        {

        }

        universe_file.close();
    }
}

void OpenRGBE131ReceiverDialog::on_ButtonLoadMap_clicked()
{
    this->LoadMap();
}

json OpenRGBE131ReceiverDialog::LumenCommand(const json& r)
{
 auto method=r.at("method").get<std::string>();auto controllers=OpenRGBE131ReceiverPlugin::api->GetRGBControllers();
 if(method=="config.set"){
  auto c=r.at("config");if(!c.at("universes").is_array()||c["universes"].size()>512)throw std::runtime_error("Invalid universe list");
  std::vector<universe_entry> staged;std::vector<int> ids;
  for(auto& u:c["universes"]){lumen::Number(u,"universe",1,63999);int id=u["universe"];if(std::find(ids.begin(),ids.end(),id)!=ids.end())throw std::runtime_error("Duplicate universe");ids.push_back(id);universe_entry entry{};entry.universe=id;
   if(!u.at("members").is_array()||u["members"].size()>128)throw std::runtime_error("Invalid members");
   for(auto& m:u["members"]){lumen::Number(m,"controller",0,static_cast<int>(controllers.size())-1);auto* ctrl=controllers[m["controller"].get<size_t>()];lumen::Number(m,"start_channel",1,510);lumen::Number(m,"start_led",0,ctrl->GetLEDCount()-1);lumen::Number(m,"num_leds",1,170);if(m["start_channel"].get<int>()+m["num_leds"].get<int>()*3>513||m["start_led"].get<int>()+m["num_leds"].get<int>()>static_cast<int>(ctrl->GetLEDCount())||!m.at("update").is_boolean())throw std::runtime_error("Mapping exceeds channel or LED bounds");entry.members.push_back({ctrl,m["start_channel"],m["start_led"],m["num_leds"],m["update"]});}staged.push_back(entry);
  }
  if(!c.at("enable_multicast").is_boolean()||!c.at("enable_autostart").is_boolean())throw std::runtime_error("Invalid receiver flags");
  on_ButtonStopReceiver_clicked();universe_list=staged;ui->EnableMulticastBox->setChecked(c["enable_multicast"]);ui->EnableAutoStartBox->setChecked(c["enable_autostart"]);UpdateTreeView();on_ButtonSaveMap_clicked();
 }else if(method=="automap"){on_ButtonStopReceiver_clicked();AutoMap();UpdateTreeView();}
 else if(method=="start")StartReceiver();
 else if(method=="stop")on_ButtonStopReceiver_clicked();
 else if(method!="config.get")throw std::runtime_error("Unknown E1.31 method");
 json universes=json::array();for(auto& u:universe_list){json members=json::array();for(auto& m:u.members){auto it=std::find(controllers.begin(),controllers.end(),m.controller);if(it!=controllers.end())members.push_back({{"controller",std::distance(controllers.begin(),it)},{"start_channel",m.start_channel},{"start_led",m.start_led},{"num_leds",m.num_leds},{"update",m.update}});}universes.push_back({{"universe",u.universe},{"members",members}});}
 return {{"config",{{"universes",universes},{"enable_multicast",ui->EnableMulticastBox->isChecked()},{"enable_autostart",ui->EnableAutoStartBox->isChecked()}}},{"running",online.load()},{"received",received_count.load()},{"source",ui->ReceiverSourceValue->text().toStdString()}};
}
