#!/bin/bash

while true; do
  echo "$(date '+%Y-%m-%d %H:%M:%S') $(ping -c 1 -q ai.mediavision.se | grep 'packet loss\|rtt' | tr '\n' ' ')" | tee -a ping.log
  sleep 5
done