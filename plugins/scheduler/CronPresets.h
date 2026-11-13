/*---------------------------------------------------------*\
| CronPresets.h                                             |
|                                                           |
|   Scheduler cron preset definitions                       |
|                                                           |
|   This file is part of the OpenRGB Scheduler Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#pragma once

#include <string>
#include <map>

static const std::map<std::string, std::string> CRON_PRESETS = {
    {"Every second","* * * * * ?"},
    {"Every minute", "0 * * * * ?"},
    {"Every hour", "* 0 * * * ?"},
    {"Every Weekday at noon", "0 0 12 * * MON-FRI"},
    {"Every 2 days, starting on the 1st at noon", "0 0 12 1/2 * ?"},
    {"Every twelve hours", "0 0 */12 ? * *"},
    {"Every day at 8.30am", "0 30 8 * * ?"},
    {"Every day at 10pm", "0 0 22 * * ?"},
};
