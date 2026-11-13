/*---------------------------------------------------------*\
| ENESMBusInterface_i2c_smbus.cpp                           |
|                                                           |
|   ENE SMBus interface for I2C/SMBus                       |
|                                                           |
|   Adam Honse (CalcProgrammer1)                21 Nov 2021 |
|                                                           |
|   This file is part of the OpenRGB project                |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#include "ENESMBusInterface_i2c_smbus.h"

ENESMBusInterface_i2c_smbus::ENESMBusInterface_i2c_smbus(i2c_smbus_interface* bus)
{
    this->bus = bus;
}

ENESMBusInterface_i2c_smbus::~ENESMBusInterface_i2c_smbus()
{

}

ene_interface_type ENESMBusInterface_i2c_smbus::GetInterfaceType()
{
    return(ENE_INTERFACE_TYPE_I2C_SMBUS);
}

std::string ENESMBusInterface_i2c_smbus::GetLocation()
{
    std::string return_string(bus->info.device_name);
    return("I2C: " + return_string);
}

int ENESMBusInterface_i2c_smbus::GetMaxBlock()
{
    return(3);
}

unsigned char ENESMBusInterface_i2c_smbus::ENERegisterRead(ene_dev_id dev, ene_register reg)
{
    //Write ENE register
    bus->i2c_smbus_write_word_data(dev, 0x00, ((reg << 8) & 0xFF00) | ((reg >> 8) & 0x00FF));

    //Read ENE value
    return(bus->i2c_smbus_read_byte_data(dev, 0x81));
}

bool ENESMBusInterface_i2c_smbus::ENERegisterReadChecked(ene_dev_id dev, ene_register reg, unsigned char& value)
{
    // Do not read from an old register pointer when selecting the new one failed.
    if(bus->i2c_smbus_write_word_data(dev, 0x00, ((reg << 8) & 0xFF00) | ((reg >> 8) & 0x00FF)) != 0)
        return false;
    const int result = bus->i2c_smbus_read_byte_data(dev, 0x81);
    if(result < 0)
        return false;
    value = static_cast<unsigned char>(result);
    return true;
}

void ENESMBusInterface_i2c_smbus::ENERegisterWrite(ene_dev_id dev, ene_register reg, unsigned char val)
{
    //Write ENE register
    bus->i2c_smbus_write_word_data(dev, 0x00, ((reg << 8) & 0xFF00) | ((reg >> 8) & 0x00FF));

    //Write ENE value
    bus->i2c_smbus_write_byte_data(dev, 0x01, val);
}

void ENESMBusInterface_i2c_smbus::ENERegisterWriteBlock(ene_dev_id dev, ene_register reg, unsigned char * data, unsigned char sz)
{
    //Write ENE register
    bus->i2c_smbus_write_word_data(dev, 0x00, ((reg << 8) & 0xFF00) | ((reg >> 8) & 0x00FF));

    //Write ENE block data
    if(bus->i2c_smbus_write_block_data(dev, 0x03, sz, data) == -1)
    {
        //Fall back to individual byte operations if the block operation fails
        for(unsigned int block_byte = 0; block_byte < sz; block_byte++)
        {
            bus->i2c_smbus_write_byte_data(dev, 0x01, data[block_byte]);
        }
    }
}
