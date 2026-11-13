/*---------------------------------------------------------*\
| HttpHookMainView.cpp                                      |
|                                                           |
|   Main view managing all HTTP hook tabs                   |
|                                                           |
|   This file is part of the OpenRGB Http Hook Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#include "HttpHookMainView.h"
#include "OpenRGBHttpHookPlugin.h"
#include "../LumenProtocol.h"
#include "ui_HttpHookMainView.h"
#include "HookSettings.h"
#include "TabHeader.h"
#include <QTimer>
#include <QTabBar>
#include <QToolButton>
#include <QAction>
#include <QMenu>
#include <QDialog>

HttpHookMainView::HttpHookMainView(QWidget *parent) :
    QWidget(parent),
    ui(new Ui::HttpHookMainView)
{
    ui->setupUi(this);
    ui->ip->setText("127.0.0.1");

    // remove intial dummy tabs
    ui->tabs->clear();

    // define tab style + settings
    ui->tabs->setTabsClosable(true);
    ui->tabs->setStyleSheet("QTabBar::close-button{image:url(:images/close.png);}");
    ui->tabs->tabBar()->setStyleSheet("QTabBar::tab:hover {text-decoration: underline;}");

    QMenu* main_menu = new QMenu(this);

    QLabel* no_hook = new QLabel("You have no hook.\n You can add one by clicking the HTTPHook button.");
    no_hook->setAlignment(Qt::AlignCenter);

    // First tab: add button
    QPushButton* main_menu_button = new QPushButton();
    main_menu_button->setText("HTTPHook");
    ui->tabs->addTab(no_hook, QString(""));
    ui->tabs->tabBar()->setTabButton(0, QTabBar::RightSide, main_menu_button);
    ui->tabs->setTabEnabled(0, false);
    main_menu_button->setMenu(main_menu);

    QAction* new_measure = new QAction("New hook", this);
    connect(new_measure, &QAction::triggered, this, &HttpHookMainView::AddTabSlot);
    main_menu->addAction(new_measure);

    auto hook_callback = [&](std::string verb, std::string path){

        bool ok = false;

        for(HttpHook* hook: hooks)
        {
            if(hook->verb == verb && hook->path == path)
            {
                QMetaObject::invokeMethod(hook,[hook](){hook->Run();},Qt::QueuedConnection);
                ok = true;
            }
        }

        return ok;
    };

    server = new HttpServer();
    server->SetHookCallback(hook_callback);
    server->SetupRoute();

    //QTimer::singleShot(2000, this, [=](){
        AutoLoad();
        UpdateStatus();
    //});
}

HttpHookMainView::~HttpHookMainView()
{
    Stop();
    delete server;
    delete ui;
}

void HttpHookMainView::Start()
{
    server->Start(ui->ip->text().toStdString(), ui->port->value());
    UpdateStatus();

    running = server->State();

    ui->start_stop->setText(running?"Stop":"Start");
}

void HttpHookMainView::Stop()
{
    server->Stop();
    UpdateStatus();

    running = false;

    ui->start_stop->setText("Start");
}

void HttpHookMainView::UpdateProfileList()
{
    /*-----------------------------------------------------*\
    | Refresh the profile list shown in every HTTP hook tab |
    | so they all reflect the current set of profiles       |
    \*-----------------------------------------------------*/
    for(HttpHook* hook : hooks)
    {
        if(hook != nullptr)
        {
            hook->ReloadProfileList();
        }
    }
}

void HttpHookMainView::on_start_stop_clicked()
{
    if(running)
    {
        Stop();
    }
    else
    {
        Start();
    }
}

void HttpHookMainView::on_save_clicked()
{    
    json j;

    std::vector<json> hooks_json;

    for(HttpHook* hook: hooks)
    {
        hooks_json.push_back(hook->ToJson());
    }

    j["hooks"] = hooks_json;

    j["ip"] = ui->ip->text().toStdString();
    j["port"] = ui->port->value();
    j["auto_start"] = ui->auto_start->isChecked();

    HookSettings::Save(j);
}

void HttpHookMainView::UpdateStatus()
{
    bool state = server->State();

    ui->status->setText(state ? "Running" : "Stopped");
}

void HttpHookMainView::AddTabSlot()
{
    AddTab();
}

HttpHook* HttpHookMainView::AddTab()
{
    HttpHook* hook = new HttpHook(this);

    int tab_size = ui->tabs->count();

    // insert at the end
    int tab_position = tab_size;

    std::string tab_name = hook->GetName();

    TabHeader* tab_header = new TabHeader();
    tab_header->Rename(QString::fromUtf8(tab_name.c_str()));

    hook->Rename(tab_name);

    ui->tabs->insertTab(tab_position, hook , "");
    ui->tabs->tabBar()->setTabButton(tab_position, QTabBar::RightSide, tab_header);

    ui->tabs->setCurrentIndex(tab_position);

    connect(hook, &HttpHook::Renamed, [=](std::string new_name){
        tab_header->Rename(QString::fromUtf8(new_name.c_str()));
    });

    connect(tab_header, &TabHeader::RenameRequest, [=](QString new_name){
        hook->Rename(new_name.toStdString());
    });

    connect(tab_header, &TabHeader::CloseRequest, [=](){
        int tab_idx = ui->tabs->indexOf(hook);

        ui->tabs->removeTab(tab_idx);

        hooks.erase(std::find(hooks.begin(), hooks.end(), hook));

        delete hook;
        delete tab_header;
    });

    ui->tabs->update();

    hooks.push_back(hook);

    return hook;
}

void HttpHookMainView::AutoLoad()
{
    json j = HookSettings::Load();

    if(j.contains("hooks"))
    {
        for(json hook_data : j["hooks"])
        {
            HttpHook* hook = AddTab();
            hook->FromJSON(hook_data);
        }
    }

    if(j.contains("ip"))
    {
        ui->ip->setText(QString::fromStdString(j["ip"]));
    }

    if(j.contains("port"))
    {
        ui->port->setValue(j["port"]);
    }

    if(j.contains("auto_start"))
    {
        bool auto_start = j["auto_start"];
        ui->auto_start->setChecked(auto_start);

        if(auto_start)
        {
            Start();
        }
    }
}

json HttpHookMainView::LumenCommand(const json& r)
{
 auto method=r.at("method").get<std::string>();
 if(method=="config.set"){
  const auto& c=r.at("config");lumen::Number(c,"port",1024,65535);auto ip=c.at("ip").get<std::string>();auto octets=QString::fromStdString(ip).split('.');bool valid=ip=="::1";if(octets.size()==4){valid=true;for(auto& o:octets){bool ok=false;int n=o.toInt(&ok);if(!ok||n<0||n>255)valid=false;}}if(!valid)throw std::runtime_error("Invalid bind address");
  if(!c.at("hooks").is_array()||c["hooks"].size()>128||!c.at("auto_start").is_boolean())throw std::runtime_error("Invalid hooks configuration");
  for(auto& h:c["hooks"]){lumen::Name(h.at("name"));lumen::Number(h,"verb",0,1);if(h.at("action")!=0||!h.at("sub_action").is_string())throw std::runtime_error("Invalid hook action");auto p=h.at("path").get<std::string>();if(p.empty()||p.size()>128||p.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")!=std::string::npos)throw std::runtime_error("Hook path must contain letters, digits, dash or underscore");}
  Stop();for(auto* h:hooks){ui->tabs->removeTab(ui->tabs->indexOf(h));delete h;}hooks.clear();
  for(auto& h:c["hooks"])AddTab()->FromJSON(h);
  ui->ip->setText(QString::fromStdString(ip));ui->port->setValue(c["port"]);ui->auto_start->setChecked(c["auto_start"]);on_save_clicked();
 }else if(method=="start"){Start();if(!server->State())throw std::runtime_error("Cannot bind HTTP port");}
 else if(method=="stop")Stop();
 else if(method=="run"){auto i=r.at("index").get<size_t>();if(i>=hooks.size())throw std::runtime_error("Hook not found");hooks[i]->Run();}
 else if(method!="config.get")throw std::runtime_error("Unknown HTTP method");
 json list=json::array();for(auto* h:hooks)list.push_back(h->ToJson());
 return {{"config",{{"hooks",list},{"ip",ui->ip->text().toStdString()},{"port",ui->port->value()},{"auto_start",ui->auto_start->isChecked()}}},{"running",server->State()},{"profiles",OpenRGBHttpHookPlugin::api->GetProfileList()}};
}
