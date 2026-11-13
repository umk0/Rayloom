/*---------------------------------------------------------*\
| EditHookAction.h                                          |
|                                                           |
|   Hook action editor widget                               |
|                                                           |
|   This file is part of the OpenRGB Http Hook Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#pragma once

#include <QWidget>

namespace Ui {
class EditHookAction;
}

class EditHookAction : public QWidget
{
    Q_OBJECT

public:
    explicit EditHookAction(QWidget *parent = nullptr);
    ~EditHookAction();

    void Reload();
signals:
    void updated(int, std::string);

private slots:
     void on_action_currentIndexChanged(int);
     void on_sub_action_currentIndexChanged(int);

private:
    Ui::EditHookAction *ui;
};
