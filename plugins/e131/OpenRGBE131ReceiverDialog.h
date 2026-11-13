/*---------------------------------------------------------*\
| OpenRGBE131ReceiverDialog.h                               |
|                                                           |
|   OpenRGB E1.31 Receiver Plugin Dialog                    |
|                                                           |
|   Adam Honse <calcprogrammer1@gmail.com>      05 Jan 2021 |
|                                                           |
|   This file is part of the OpenRGB E1.31 Receiver Plugin  |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#pragma once

#include <shared_mutex>
#include <thread>
#include <atomic>
#include <nlohmann/json.hpp>
#include <QWidget>

namespace Ui
{
    class OpenRGBE131ReceiverDialog;
}

class OpenRGBE131ReceiverDialog : public QWidget
{
    Q_OBJECT

public:
    explicit OpenRGBE131ReceiverDialog(QWidget *parent = nullptr);
    ~OpenRGBE131ReceiverDialog();

    void AutoMap();
    nlohmann::json LumenCommand(const nlohmann::json& request);

    void E131ReceiverThreadFunction();

    void ResourceManagerUpdated(unsigned int update_reason);

public slots:
    void DeviceListChanged();

private slots:
    void on_ButtonStartReceiver_clicked();
    void on_ButtonStopReceiver_clicked();
    void on_ButtonAddController_clicked();
    void on_ButtonRemoveController_clicked();
    void on_ButtonAddUniverse_clicked();
    void on_ButtonRemoveUniverse_clicked();
    void on_ButtonAutoMap_clicked();
    void on_ButtonSaveMap_clicked();
    void on_ButtonLoadMap_clicked();

    void LineEdit_updated_slot(QObject* lineedit_argument);
    void CheckBox_updated_slot(QObject* checkbox_argument);

private:
    Ui::OpenRGBE131ReceiverDialog * ui;

    std::shared_mutex               controller_mutex;
    std::atomic<bool>               online{false};
    bool                            initialized;
    std::atomic<unsigned long>      received_count{0};

    std::thread*                    E131ReceiverThread = nullptr;

    void                            UpdateOnlineStatus();
    void                            UpdateControllersTreeView();
    void                            UpdateTreeView();
    void                            LoadMap();
    void                            StartReceiver();
};
