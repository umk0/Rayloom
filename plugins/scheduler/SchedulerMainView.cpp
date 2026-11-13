/*---------------------------------------------------------*\
| SchedulerMainView.cpp                                     |
|                                                           |
|   Scheduler main view                                     |
|                                                           |
|   This file is part of the OpenRGB Scheduler Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#include "SchedulerMainView.h"
#include "OpenRGBSchedulerPlugin.h"
#include "CronPresets.h"
#include "../LumenProtocol.h"
#include "ScheduledTask.h"
#include "SchedulerSettings.h"
#include "TabHeader.h"
#include <iostream>
#include <QTimer>
#include <QTabBar>
#include <QToolButton>
#include <QAction>
#include <QMenu>
#include <QDialog>
#include <QLabel>

SchedulerMainView::SchedulerMainView(QWidget *parent) :
    QWidget(parent),
    ui(new Ui::SchedulerMainView)
{
    ui->setupUi(this);

    // remove intial dummy tabs
    ui->tabs->clear();

    // define tab style + settings
    ui->tabs->setTabsClosable(true);
    ui->tabs->setStyleSheet("QTabBar::close-button{image:url(:images/close.png);}");
    ui->tabs->tabBar()->setStyleSheet("QTabBar::tab:hover {text-decoration: underline;}");

    QMenu* main_menu = new QMenu(this);

    QLabel* no_task = new QLabel("You have no task.\n You can add one by clicking the Schedule button.");
    no_task->setAlignment(Qt::AlignCenter);

    // First tab: add button
    QPushButton* main_menu_button = new QPushButton();
    main_menu_button->setText("Schedule");
    ui->tabs->addTab(no_task, QString(""));
    ui->tabs->tabBar()->setTabButton(0, QTabBar::RightSide, main_menu_button);
    ui->tabs->setTabEnabled(0, false);
    main_menu_button->setMenu(main_menu);

    QAction* new_task = new QAction("New task", this);
    connect(new_task, &QAction::triggered, this, &SchedulerMainView::AddTabSlot);
    main_menu->addAction(new_task);

    // Make sure to wait a bit before all other plugins are loaded
    QTimer::singleShot(2000, this, [this](){
        if(lumen_configured) return;
        json task_list = SchedulerSettings::Load();

        for(const json& text_task : task_list)
        {
            AddTask(ScheduledTask::FromJson(this, text_task));
        }

        // Check for missed tasks, reschedule them and execute the latest missed tasks
        // If a task was missed multiple times only the first miss will be considered at determining the latest task
        // Example: OpenRGB got shut down at 12:30, Task1 should be run 12:35 and 12:45 and Task2 should be run at 12:40.
        // Because only the first miss can be considered, Task2 will be run on the next start of OpenRGB
        ScheduledTask *current_active = nullptr;
        std::chrono::time_point<std::chrono::system_clock> current_missed_time_point;

        for(auto *sched_task : tasks)
        {
            auto next_run = sched_task->GetNextRun();
            if(sched_task->IsRunning() &&
               next_run != std::chrono::system_clock::time_point{std::chrono::system_clock::duration{0}} &&
               next_run < std::chrono::system_clock::now())
            {
                if (!current_active || next_run > current_missed_time_point)
                {
                    current_active = sched_task;
                    // Need to save current time point before recalculating next run
                    current_missed_time_point = next_run;
                }

                sched_task->RecalculateNextRun();
            }
        }

        if(current_active)
        {
            std::cout << "[OpenRGBVisualMapPlugin] Running Missed Task " << current_active->GetName() << std::endl;
            current_active->TaskFunction();
        }
    });

}

SchedulerMainView::~SchedulerMainView()
{
    StopAllTasks();
    delete ui;
}

void SchedulerMainView::StopAllTasks()
{
    /*-----------------------------------------------------*\
    | Stop every running task. The ScheduledTask::Stop()    |
    | clears the cron schedules and joins/destroys each     |
    | task's worker thread so no task can trigger after     |
    | the plugin unloads.                                   |
    \*-----------------------------------------------------*/
    for(ScheduledTask* task : tasks)
    {
        if(task != nullptr)
        {
            task->Stop();
        }
    }

    /*-----------------------------------------------------*\
    | Clear the task registry. The ScheduledTask widgets    |
    | themselves remain children of the tabs widget and     |
    | are properly destroyed through Qt's parent-child      |
    | ownership when the whole view is deleted.             |
    \*-----------------------------------------------------*/
    tasks.clear();
}

void SchedulerMainView::UpdateProfileList()
{
    /*-----------------------------------------------------*\
    | Refresh the profile list for each task                |
    \*-----------------------------------------------------*/
    for(ScheduledTask* task : tasks)
    {
        if(task != nullptr)
        {
            task->ReloadSubActions();
        }
    }
}

void SchedulerMainView::AddTabSlot()
{
    AddTask(new ScheduledTask());
}

void SchedulerMainView::AddTask(ScheduledTask* task)
{
    int tab_size = ui->tabs->count();

    // insert at the end
    int tab_position = tab_size;

    std::string tab_name = task->GetName();

    TabHeader* tab_header = new TabHeader();
    tab_header->Rename(QString::fromUtf8(tab_name.c_str()));

    task->Rename(tab_name);

    ui->tabs->insertTab(tab_position, task , "");
    ui->tabs->tabBar()->setTabButton(tab_position, QTabBar::RightSide, tab_header);

    connect(task, &ScheduledTask::TaskState, [=](bool state){
        tab_header->ToogleRunningIndicator(state);
    });

    ui->tabs->setCurrentIndex(tab_position);

    connect(task, &ScheduledTask::Renamed, [=](std::string new_name){
        tab_header->Rename(QString::fromUtf8(new_name.c_str()));
    });

    connect(tab_header, &TabHeader::RenameRequest, [=](QString new_name){
        task->Rename(new_name.toStdString());
    });

    connect(task, &ScheduledTask::NextRunChanged, this, &SchedulerMainView::on_save_clicked);

    connect(tab_header, &TabHeader::CloseRequest, [=](){
        int tab_idx = ui->tabs->indexOf(task);

        ui->tabs->removeTab(tab_idx);

        tasks.erase(std::find(tasks.begin(), tasks.end(), task));

        delete task;
        delete tab_header;
    });

    connect(tab_header, &TabHeader::StartStopRequest, [=](){

        if(task->IsRunning())
        {
            task->Stop();
        }
        else
        {
            task->Start();
        }
    });

    tab_header->ToogleRunningIndicator(task->IsRunning());

    ui->tabs->update();

    tasks.push_back(task);

}

void SchedulerMainView::on_save_clicked()
{
    std::vector<json> v;

    for(ScheduledTask* task: tasks)
    {
        v.push_back(task->ToJson());
    }

    json j = v;

    SchedulerSettings::Save(j);
}

json SchedulerMainView::LumenCommand(const json& r)
{
 auto method=r.at("method").get<std::string>();
 if(method=="config.set") {
   auto list=r.at("tasks");if(!list.is_array()||list.size()>64)throw std::runtime_error("At most 64 tasks");
   auto profiles=OpenRGBSchedulerPlugin::api->GetProfileList();
   for(auto& t:list){lumen::Name(t.at("name"));if(t.at("action")!=0||!t.at("run").is_boolean())throw std::runtime_error("Invalid task action");Cron check;if(!check.add_schedule("validate",t.at("cron_line").get<std::string>(),[](auto&){}))throw std::runtime_error("Invalid cron expression");if(t.at("run").get<bool>()&&std::find(profiles.begin(),profiles.end(),t.at("sub_action").get<std::string>())==profiles.end())throw std::runtime_error("Profile does not exist");}
   lumen_configured = true;
   for(auto* t:tasks){t->disconnect(this);t->Stop();ui->tabs->removeTab(ui->tabs->indexOf(t));delete t;}tasks.clear();
   for(auto t:list){t["next_run"]=0;AddTask(ScheduledTask::FromJson(this,t));}
   on_save_clicked();
 } else if(method=="run") {auto index=r.at("index").get<size_t>();if(index>=tasks.size())throw std::runtime_error("Task not found");tasks[index]->TaskFunction();}
 else if(method=="stop"){for(auto* task:tasks)task->Stop();on_save_clicked();}
 else if(method!="config.get")throw std::runtime_error("Unknown scheduler method");
 json list=json::array();for(auto* t:tasks)list.push_back(t->ToJson());
 return {{"tasks",list},{"profiles",OpenRGBSchedulerPlugin::api->GetProfileList()},{"presets",CRON_PRESETS}};
}
