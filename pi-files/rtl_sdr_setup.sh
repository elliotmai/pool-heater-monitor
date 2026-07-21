#!/bin/bash

# RTL-SDR Setup Script for Raspberry Pi (Buster-compatible)
# This script works around repository issues on older Raspbian versions

echo "=================================================="
echo "RTL-SDR Setup for Antonki Thermometers"
echo "=================================================="
echo ""

# First, try to fix the repository issues
echo "Step 1: Attempting to fix repository configuration..."

# Backup sources list
sudo cp /etc/apt/sources.list /etc/apt/sources.list.backup

# Update to legacy archive for Buster
sudo bash -c 'cat > /etc/apt/sources.list << EOF
deb http://legacy.raspbian.org/raspbian/ buster main contrib non-free rpi
# Uncomment line below then '\''apt-get update'\'' to enable '\''apt-get source'\''
#deb-src http://legacy.raspbian.org/raspbian/ buster main contrib non-free rpi
EOF'

echo ""
echo "Step 2: Updating package lists..."
sudo apt-get update

echo ""
echo "Step 3: Installing RTL-SDR drivers and basic tools..."
# Try to install what we can from repositories
sudo apt-get install -y rtl-sdr librtlsdr0 librtlsdr-dev || echo "Some packages failed, continuing..."

# Blacklist DVB-T drivers that conflict with RTL-SDR
echo ""
echo "Step 4: Blacklisting conflicting drivers..."
sudo bash -c 'cat > /etc/modprobe.d/rtl-sdr-blacklist.conf << EOF
blacklist dvb_usb_rtl28xxu
blacklist rtl2832
blacklist rtl2830
EOF'

# Try to install build dependencies
echo ""
echo "Step 5: Installing available build dependencies..."
sudo apt-get install -y \
    build-essential \
    git \
    libusb-1.0-0-dev \
    pkg-config \
    2>/dev/null || echo "Some packages unavailable, will try manual install..."

# Check if cmake is installed, if not try to install or build it
echo ""
echo "Step 6: Checking for cmake..."
if ! command -v cmake &> /dev/null; then
    echo "cmake not found, attempting to install..."
    sudo apt-get install -y cmake 2>/dev/null
   
    if ! command -v cmake &> /dev/null; then
        echo "cmake installation from repos failed, trying to install from pip..."
        # Try installing cmake via pip as fallback
        sudo apt-get install -y python3-pip
        pip3 install cmake --user
        export PATH="$HOME/.local/bin:$PATH"
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
    fi
fi

# Verify cmake is now available
if ! command -v cmake &> /dev/null; then
    echo "ERROR: Could not install cmake. Trying alternative approach..."
    echo "Installing pre-built rtl_433 binary instead..."
   
    cd ~
    # Download pre-built binary for ARM
    wget https://github.com/merbanan/rtl_433/releases/download/23.11/rtl_433-23.11-linux-armhf.tar.gz 2>/dev/null || {
        echo "ERROR: Could not download pre-built binary."
        echo "Manual installation required. See alternative instructions below."
        exit 1
    }
   
    tar -xzf rtl_433-23.11-linux-armhf.tar.gz
    sudo cp rtl_433 /usr/local/bin/
    sudo chmod +x /usr/local/bin/rtl_433
    rm rtl_433-23.11-linux-armhf.tar.gz
   
    echo "Installed pre-built rtl_433 binary successfully!"
   
else
    # Build from source if cmake is available
    echo ""
    echo "Step 7: Building rtl_433 from source..."
    cd ~
   
    if [ -d "rtl_433" ]; then
        echo "rtl_433 directory exists, removing..."
        rm -rf rtl_433
    fi
   
    git clone https://github.com/merbanan/rtl_433.git
    cd rtl_433
    mkdir build
    cd build
   
    cmake .. || {
        echo "cmake configuration failed, trying with minimal options..."
        cmake -DENABLE_SOAPYSDR=OFF .. || {
            echo "ERROR: cmake failed completely"
            exit 1
        }
    }
   
    make -j4 || {
        echo "Build with parallel jobs failed, trying single-threaded..."
        make || {
            echo "ERROR: Build failed"
            exit 1
        }
    }
   
    sudo make install
    sudo ldconfig
fi

# Add udev rules for RTL-SDR
echo ""
echo "Step 8: Setting up udev rules..."
sudo bash -c 'cat > /etc/udev/rules.d/rtl-sdr.rules << EOF
SUBSYSTEM=="usb", ATTRS{idVendor}=="0bda", ATTRS{idProduct}=="2838", MODE="0666"
EOF'

sudo udevadm control --reload-rules
sudo udevadm trigger

# Add user to plugdev group
echo ""
echo "Step 9: Adding user to plugdev group..."
sudo usermod -a -G plugdev $USER

echo ""
echo "=================================================="
echo "Installation complete!"
echo "=================================================="
echo ""

# Test if rtl_433 is available
if command -v rtl_433 &> /dev/null; then
    echo "✓ rtl_433 is installed and available"
    rtl_433 -V
else
    echo "✗ rtl_433 installation may have failed"
    echo ""
    echo "ALTERNATIVE: Manual installation instructions"
    echo "=============================================="
    echo "If automatic installation failed, try:"
    echo ""
    echo "1. Install rtl-sdr manually:"
    echo "   sudo apt-get install rtl-sdr"
    echo ""
    echo "2. Download and install rtl_433 pre-built binary:"
    echo "   cd ~"
    echo "   wget https://github.com/merbanan/rtl_433/releases/latest/download/rtl_433-linux-armhf.tar.gz"
    echo "   tar -xzf rtl_433-linux-armhf.tar.gz"
    echo "   sudo cp rtl_433 /usr/local/bin/"
    echo "   sudo chmod +x /usr/local/bin/rtl_433"
    echo ""
fi

echo ""
echo "IMPORTANT: Please reboot your Raspberry Pi now:"
echo "  sudo reboot"
echo ""
echo "After reboot, test your RTL-SDR with:"
echo "  rtl_test"
echo ""
echo "To scan for your Antonki thermometers:"
echo "  rtl_433 -f 433.92M -s 250k"
echo ""
echo "=================================================="
