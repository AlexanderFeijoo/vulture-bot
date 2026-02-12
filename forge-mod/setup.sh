#!/bin/bash
# Bootstrap Gradle wrapper and build the mod
set -e
cd "$(dirname "$0")"

if [ ! -f gradlew ]; then
    echo "Bootstrapping Gradle wrapper..."
    GRADLE_VERSION=8.1.1
    DIST_URL="https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip"

    curl -Lo /tmp/gradle-dist.zip "$DIST_URL"
    unzip -qo /tmp/gradle-dist.zip -d /tmp/gradle-tmp

    /tmp/gradle-tmp/gradle-${GRADLE_VERSION}/bin/gradle wrapper --gradle-version ${GRADLE_VERSION}

    rm -rf /tmp/gradle-dist.zip /tmp/gradle-tmp
    echo "Gradle wrapper created."
fi

echo "Building nuncle-nelson mod..."
./gradlew build
