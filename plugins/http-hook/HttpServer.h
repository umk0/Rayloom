/*---------------------------------------------------------*\
| HttpServer.h                                              |
|                                                           |
|   HTTP server for the plugin                              |
|                                                           |
|   This file is part of the OpenRGB Http Hook Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#pragma once

#include "httplib.h"

class HttpServer
{
public:
    HttpServer();

    void SetHookCallback(std::function<bool(std::string, std::string)> callback);
    void SetupRoute();

    void Start(std::string ip, int port);
    void Stop();

    bool State();

private:
    httplib::Server svr;

    std::thread* t = nullptr;
    void ThreadFunction();

    std::function<bool(std::string, std::string)> callback;

    std::string ip = "0.0.0.0";
    int port = 8080;
};
