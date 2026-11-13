/*---------------------------------------------------------*\
| EditableLabel.h                                           |
|                                                           |
|   Editable label widget                                   |
|                                                           |
|   This file is part of the OpenRGB Http Hook Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#pragma once

#include <QWidget>
#include <QLineEdit>

namespace Ui {
class EditableLabel;
}

class EditableLabel : public QLineEdit
{
    Q_OBJECT

public:
    explicit EditableLabel(QWidget *parent = nullptr);
    ~EditableLabel();

signals:
  void Focussed(bool);

protected:
  virtual void focusInEvent(QFocusEvent*);
  virtual void focusOutEvent(QFocusEvent*);
  virtual void mousePressEvent(QMouseEvent*);

private:
    Ui::EditableLabel *ui;
};
