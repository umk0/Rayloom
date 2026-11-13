/*---------------------------------------------------------*\
| EditableLabel.cpp                                         |
|                                                           |
|   Editable label widget                                   |
|                                                           |
|   This file is part of the OpenRGB Http Hook Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#include "EditableLabel.h"

EditableLabel::EditableLabel(QWidget *parent) : QLineEdit(parent){}
EditableLabel::~EditableLabel(){}

void EditableLabel::focusInEvent(QFocusEvent *event)
{
    QLineEdit::focusInEvent(event);
    emit Focussed(true);
}

void EditableLabel::focusOutEvent(QFocusEvent *event)
{
    QLineEdit::focusOutEvent(event);
    emit Focussed(false);
}

void EditableLabel::mousePressEvent(QMouseEvent *event)
{
    QLineEdit::mousePressEvent(event);
    emit Focussed(true);
}
