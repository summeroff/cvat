
# Copyright (C) 2018 Intel Corporation
#
# SPDX-License-Identifier: MIT

default_app_config = 'cvat.apps.authentication.apps.AuthenticationConfig'

from enum import Enum

class AUTH_ROLE(Enum):
    ADMIN = 'admin'
    USER = 'user'
    ANNOTATOR = 'annotator'
    OBSERVER = 'observer'
    EXPORTER = 'exporter'

    def __str__(self):
        return self.value
