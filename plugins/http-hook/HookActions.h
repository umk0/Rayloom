/*---------------------------------------------------------*\
| HookActions.h                                             |
|                                                           |
|   Hook action identifiers                                 |
|                                                           |
|   This file is part of the OpenRGB Http Hook Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#pragma once

#include <QStringList>

enum
{
    HOOK_ACTION_LOAD_PROFILE    = 0,
};

static QStringList HOOK_ACTIONS = QStringList({"Load Profile"});
