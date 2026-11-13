/*---------------------------------------------------------*\
| HttpHookMainView.h                                        |
|                                                           |
|   Main view managing all HTTP hook tabs                   |
|                                                           |
|   This file is part of the OpenRGB Http Hook Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#pragma once

#include <QWidget>
#include "HttpServer.h"
#include "HttpHook.h"

namespace Ui {
class HttpHookMainView;
}

class HttpHookMainView : public QWidget
{
    Q_OBJECT

public:
    explicit HttpHookMainView(QWidget *parent = nullptr);
    ~HttpHookMainView();

    void Start();
    void Stop();
    void UpdateProfileList();
    json LumenCommand(const json& request);

private slots:
    void on_start_stop_clicked();
    void on_save_clicked();
    void AddTabSlot();

private:
    Ui::HttpHookMainView *ui;
    HttpServer* server;

    std::vector<HttpHook*> hooks;

    void AutoLoad();
    void UpdateStatus();
    HttpHook* AddTab();

    bool running = false;
};
