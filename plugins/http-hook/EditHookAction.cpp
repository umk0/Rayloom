/*---------------------------------------------------------*\
| EditHookAction.cpp                                        |
|                                                           |
|   Hook action editor widget                               |
|                                                           |
|   This file is part of the OpenRGB Http Hook Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#include "EditHookAction.h"
#include "ui_EditHookAction.h"
#include "HookActions.h"
#include "OpenRGBHttpHookPlugin.h"
#include "ProfileManager.h"

#include <QMainWindow>

EditHookAction::EditHookAction(QWidget *parent) :
    QWidget(parent),
    ui(new Ui::EditHookAction)
{
    ui->setupUi(this);

    ui->action->addItems(HOOK_ACTIONS);
}

EditHookAction::~EditHookAction()
{
    delete ui;
}

void EditHookAction::Reload()
{
    ui->sub_action->blockSignals(true);

    /*-----------------------------------------------------*\
    | Save the currently selected profile (if any) so we    |
    | can restore it after rebuilding the list.             |
    \*-----------------------------------------------------*/
    std::string selected_profile = ui->sub_action->currentData().toString().toStdString();

    ui->sub_action->clear();

    int action_index = ui->action->currentIndex();

    switch(action_index)
    {
        case HOOK_ACTION_LOAD_PROFILE:
        {
            std::vector<std::string> profiles = OpenRGBHttpHookPlugin::api->GetProfileList();

            for(std::string& profile: profiles)
            {
                ui->sub_action->addItem(QString::fromStdString(profile), QString::fromStdString(profile));
            }

            break;
        }
        default:
            break;
    }

    /*-----------------------------------------------------*\
    | Restore the previous selection if that profile still  |
    | exists in the list.                                   |
    \*-----------------------------------------------------*/
    if(!selected_profile.empty())
    {
        int index = ui->sub_action->findData(QString::fromStdString(selected_profile));
        ui->sub_action->setCurrentIndex(index);
    }

    ui->sub_action->blockSignals(false);
}

void EditHookAction::on_action_currentIndexChanged(int)
{
    Reload();
    emit updated(ui->action->currentIndex(), ui->sub_action->currentData().toString().toStdString());
}

void EditHookAction::on_sub_action_currentIndexChanged(int)
{
    emit updated(ui->action->currentIndex(), ui->sub_action->currentData().toString().toStdString());
}

