/*---------------------------------------------------------*\
| SchedulerMainView.h                                       |
|                                                           |
|   Scheduler main view                                     |
|                                                           |
|   This file is part of the OpenRGB Scheduler Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#pragma once

#include <QWidget>
#include "ui_SchedulerMainView.h"
#include "ScheduledTask.h"

namespace Ui {
class SchedulerMainView;
}

class SchedulerMainView : public QWidget
{
    Q_OBJECT

public:
    explicit SchedulerMainView(QWidget *parent = nullptr);
    ~SchedulerMainView();

    void StopAllTasks();
    void UpdateProfileList();
    json LumenCommand(const json& request);

private slots:
    void on_save_clicked();
    void AddTabSlot();

private:
    Ui::SchedulerMainView *ui;
    bool lumen_configured = false;

    std::vector<ScheduledTask*> tasks;

    void AddTask(ScheduledTask*);
};
