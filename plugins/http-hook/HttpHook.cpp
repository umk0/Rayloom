/*---------------------------------------------------------*\
| HttpHook.cpp                                              |
|                                                           |
|   Individual HTTP hook widget                             |
|                                                           |
|   This file is part of the OpenRGB Http Hook Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#include "HttpHook.h"
#include "ui_HttpHook.h"
#include "OpenRGBHttpHookPlugin.h"
#include "HookActions.h"
#include "ProfileManager.h"

#include <QMenu>
#include <QAction>
#include <QMainWindow>

HttpHook::HttpHook(QWidget *parent) :
    QWidget(parent),
    ui(new Ui::HttpHook)
{
    ui->setupUi(this);

    GenerateID();

    ui->verb->addItems({"POST", "GET"});

    ui->edit_hook_action->hide();
}

HttpHook::~HttpHook()
{
    delete ui;
}

void HttpHook::Rename(std::string value)
{
    name = value;
}

std::string HttpHook::GetName()
{
    return name;
}

void HttpHook::ReloadProfileList()
{
    /*-----------------------------------------------------*\
    | Rebuild the profile list shown in the hook action     |
    | editor so it reflects the current set of profiles     |
    \*-----------------------------------------------------*/
    ui->edit_hook_action->Reload();
}

void HttpHook::Run()
{
    printf("Running Hook %s \n", path.c_str());

    switch(action)
    {
        case HOOK_ACTION_LOAD_PROFILE:
        {
            std::string profile = sub_action;

            printf("Scheduled task run: load profile [%s]\n", profile.c_str());

            OpenRGBHttpHookPlugin::api->LoadProfile(profile);
            break;
        }

        default:
            break;
    }
}

void HttpHook::on_path_textChanged(const QString)
{
    path = ui->path->text().toStdString();

    if(path.empty())
    {
        GenerateID();
    }
}

void HttpHook::GenerateID()
{
    ui->path->setText(QString::fromStdString(std::to_string(rand())));
}

void HttpHook::on_edit_hook_action_updated(int action_idx, std::string sub_action_value)
{
    action = action_idx;
    sub_action = sub_action_value;
    ui->task->setText(HOOK_ACTIONS[action] +  " " + QString::fromStdString(sub_action));
}

void HttpHook::on_edit_clicked()
{
    ui->edit_hook_action->setVisible(!ui->edit_hook_action->isVisible());

    if(ui->edit_hook_action->isVisible())
    {
        ui->edit_hook_action->Reload();
    }
}

void HttpHook::on_verb_currentIndexChanged(int)
{
    verb = ui->verb->currentText().toStdString();
}

json HttpHook::ToJson()
{
    json j;

    j["verb"]       = ui->verb->currentIndex();
    j["path"]       = ui->path->text().toStdString();
    j["action"]     = action;
    j["name"]       = name;

    switch(action)
    {
        case HOOK_ACTION_LOAD_PROFILE:
        {
            j["sub_action"] = sub_action;
            break;
        }

        default: break;
    }

    return j;
}

void HttpHook::FromJSON(json j)
{
    if(j.contains("verb"))
    {
        ui->verb->setCurrentIndex(j["verb"]);
    }

    if(j.contains("path"))
    {
        ui->path->setText(QString::fromStdString(j["path"]));
    }

    if(j.contains("action"))
    {
        action = j["action"];;
    }

    if(j.contains("sub_action"))
    {
        sub_action = j["sub_action"];
    }

    if(j.contains("name"))
    {
        name = j["name"];
        emit Renamed(name);
    }

    ui->task->setText(HOOK_ACTIONS[action] +  " " + QString::fromStdString(sub_action));
}
