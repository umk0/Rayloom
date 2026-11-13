/*---------------------------------------------------------*\
| TabHeader.h                                               |
|                                                           |
|   HTTP hook tab header widget                             |
|                                                           |
|   This file is part of the OpenRGB Http Hook Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#pragma once

#include <QWidget>

namespace Ui {
class TabHeader;
}

class TabHeader : public QWidget
{
    Q_OBJECT

public:
    explicit TabHeader(QWidget *parent = nullptr);
    ~TabHeader();
    void Rename(QString);

signals:
    void CloseRequest();
    void RenameRequest(QString);

private slots:
    void on_close_clicked();
    void on_editor_editingFinished();

private:
    Ui::TabHeader *ui;
};
