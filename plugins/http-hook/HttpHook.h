/*---------------------------------------------------------*\
| HttpHook.h                                                |
|                                                           |
|   Individual HTTP hook widget                             |
|                                                           |
|   This file is part of the OpenRGB Http Hook Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#pragma once

#include <QWidget>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

namespace Ui {
class HttpHook;
}

class HttpHook : public QWidget
{
    Q_OBJECT



public:
    explicit HttpHook(QWidget *parent = nullptr);
    ~HttpHook();

    std::string verb;
    std::string path;

    void Run();
    void Rename(std::string);
    json ToJson();
    void FromJSON(json);
    std::string GetName();
    void ReloadProfileList();

signals:
    void Renamed(std::string);

private slots:
    void on_verb_currentIndexChanged(int);
    void on_path_textChanged(const QString);

    void on_edit_clicked();
    void on_edit_hook_action_updated(int, std::string);

private:
    Ui::HttpHook *ui;

    std::string name = "Untitled";
    void GenerateID();

    int action = 0;
    std::string sub_action;
};
