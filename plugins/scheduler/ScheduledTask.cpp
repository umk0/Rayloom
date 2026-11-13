/*---------------------------------------------------------*\
| ScheduledTask.cpp                                         |
|                                                           |
|   Scheduled task widget                                   |
|                                                           |
|   This file is part of the OpenRGB Scheduler Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#include "ScheduledTask.h"
#include "ui_ScheduledTask.h"
#include "TimeUtils.h"
#include "OpenRGBSchedulerPlugin.h"
#include "CronPresets.h"
#include "ProfileManager.h"
#include <chrono>
#include <cstdio>
#include <functional>
#include <QMenu>
#include <QAction>
#include <QMainWindow>

ScheduledTask::ScheduledTask(QWidget *parent) :
    QWidget(parent),
    ui(new Ui::ScheduledTask)
{
    ui->setupUi(this);

    ui->cron_presets->addItem("Choose a preset...");

    for (auto& preset : CRON_PRESETS)
    {
        ui->cron_presets->addItem(QString::fromStdString(preset.first));
    }

    ui->action->addItems({"Load Profile"});

    ReloadSubActions();
}

ScheduledTask::~ScheduledTask()
{
    Stop();
    delete ui;
}

void ScheduledTask::TaskFunction()
{
    int action_index = ui->action->currentIndex();

    switch(action_index)
    {
        case 0:
        {
            std::string profile = ui->sub_action->currentText().toStdString();
            printf("Scheduled task run: load profile [%s]\n", profile.c_str());

            OpenRGBSchedulerPlugin::api->LoadProfile(profile);

            break;
        }

        default:
            break;
    }

    this->cron.recalculate_schedule();
    RecalculateNextRun();
}

void ScheduledTask::Start()
{
    if(timer == nullptr)
    {

        std::function<void(const libcron::TaskInformation&)> callback = [=] (auto&) {
            TaskFunction();   
        };

        bool added = cron.add_schedule(name, ui->cron_line->text().toStdString(), callback);

        if(!added)
        {
            ui->cron_line->setStyleSheet("border:2px solid red");
            return;
        }

        ui->cron_line->setStyleSheet("");

        RecalculateNextRun();

        run = true;
        timer = new QTimer(this);
        connect(timer,&QTimer::timeout,this,[this](){cron.tick();ui->next_run->setText(TimeUtils::nextRun(cron));});
        timer->start(500);

        emit TaskState(true);
    }
}

void ScheduledTask::Stop()
{
    cron.clear_schedules();

    if(timer != nullptr)
    {
        run = false;
        timer->stop();
        delete timer;
        timer = nullptr;
    }

    ui->next_run->clear();

    emit TaskState(false);
}

bool ScheduledTask::IsRunning()
{
    return run;
}

void ScheduledTask::ThreadFunction()
{
    printf("[OpenRGBVisualMapPlugin] Task thread started\n");

    while(run)
    {
        cron.tick();
        ui->next_run->setText(TimeUtils::nextRun(cron));
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }

    printf("[OpenRGBVisualMapPlugin] Task thread stopped\n");
}

void ScheduledTask::ReloadCron()
{
    bool was_running = run;

    Stop();

    if(was_running)
    {
        Start();
    }
}

void ScheduledTask::on_cron_line_editingFinished()
{
    ReloadCron();
}


void ScheduledTask::on_reload_sub_actions_clicked()
{
    ReloadSubActions();
}

void ScheduledTask::on_action_currentIndexChanged(int value)
{
    ui->sub_action->setVisible(value == 0|| value == 2);
    ui->reload_sub_actions->setVisible(value == 0 || value == 2);

    ReloadSubActions();
}

void ScheduledTask::on_cron_presets_currentIndexChanged(int value)
{
    if(value == 0)
    {
        return;
    }

    ui->cron_line->setText(QString::fromStdString(
        CRON_PRESETS.at(ui->cron_presets->currentText().toStdString())
    ));

    ReloadCron();
}

json ScheduledTask::ToJson()
{
    json j;

    j["cron_line"] = ui->cron_line->text().toStdString();
    j["run"] = run;
    j["action"] = ui->action->currentIndex();
    j["name"] = name;
    j["next_run"] = next_run.time_since_epoch().count();
    j["next_run_ms"] = std::chrono::duration_cast<std::chrono::milliseconds>(next_run.time_since_epoch()).count();

    switch(ui->action->currentIndex())
    {
        case 0:
            j["sub_action"] = ui->sub_action->currentText().toStdString();
            break;

        default:
            break;
    }

    return j;
}

ScheduledTask* ScheduledTask::FromJson(QWidget *parent, json j)
{
    ScheduledTask* task = new ScheduledTask(parent);

    if(j.contains("cron_line"))
        task->ui->cron_line->setText(QString::fromStdString(j["cron_line"]));

    if(j.contains("action"))
        task->ui->action->setCurrentIndex(j["action"]);

    if(j.contains("sub_action"))
        task->ui->sub_action->setCurrentText(QString::fromStdString(j["sub_action"]));

    if(j.contains("next_run"))
    {
        std::chrono::system_clock::time_point next_run_from_epoch {std::chrono::system_clock::duration{j["next_run"]}};
        task->next_run = next_run_from_epoch;
    }

    if(j.contains("name"))
    {
        task->name = j["name"];
    }

    if(j.contains("run") && j["run"])
    {
        task->Start();
    }

    return task;
}

std::string ScheduledTask::GetName()
{
    return name;
}

void ScheduledTask::Rename(std::string value)
{
    name = value;
    emit Renamed(name);
}

std::chrono::time_point<std::chrono::system_clock> ScheduledTask::GetNextRun()
{
    return next_run;
}

void ScheduledTask::RecalculateNextRun()
{
    auto new_next_run = std::chrono::system_clock::now() + cron.time_until_next();
    if (std::chrono::duration_cast<std::chrono::seconds>(new_next_run - next_run).count() != 0)
    {
        next_run = new_next_run;
        emit NextRunChanged();
    }
}

void ScheduledTask::ReloadSubActions()
{
    QString previous_selection = ui->sub_action->currentText();

    ui->sub_action->clear();

    int action_index = ui->action->currentIndex();

    switch(action_index)
    {
        case 0:
            {
                std::vector<std::string> profiles = OpenRGBSchedulerPlugin::api->GetProfileList();

                for(std::string& profile: profiles)
                {
                    ui->sub_action->addItem(QString::fromStdString(profile));
                }

                /*-----------------------------------------*\
                | Restore the previously selected profile   |
                | if it still exists                        |
                \*-----------------------------------------*/
                int previous_index = ui->sub_action->findText(previous_selection);
                if(previous_index != -1)
                {
                    ui->sub_action->setCurrentIndex(previous_index);
                }
            }
            break;

        default:
            break;
    }
}


