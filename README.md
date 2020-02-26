# Razeedeploy-delta

[![Build Status](https://travis-ci.com/razee-io/razeedeploy-delta.svg?branch=master)](https://travis-ci.com/razee-io/razeedeploy-delta)
[![Dependabot Status](https://api.dependabot.com/badges/status?host=github&repo=razee-io/razeedeploy-delta)](https://dependabot.com)

## Running Install/Remove Job Mnaually

1. Download [Job](https://github.com/razee-io/razeedeploy-delta/releases/latest/download/job.yaml)
1. Replace `{{ COMMAND }}` with either `install` or `remove`
1. Replace `{{ ARGS_ARRAY }}` with and array of the options you want to run. eg. `["--rr", "--wk", "-a"]`

### Install Job Options

[Code Reference](https://github.com/razee-io/razeedeploy-delta/blob/master/src/install.js#L35-L63)

```
-h, --help
    : help menu
-n, --namespace=''
    : namespace to populate razeedeploy resources into (Default 'razeedeploy')
--wk, --watch-keeper=''
    : install watch-keeper at a specific version (Default 'latest')
--rd-url, --razeedash-url=''
    : url that watch-keeper should post data to
--rd-org-key, --razeedash-org-key=''
    : org key that watch-keeper will use to authenticate with razeedash-url
--rr, --remoteresource=''
    : install remoteresource at a specific version (Default 'latest')
--rrs3, --remoteresources3=''
    : install remoteresources3 at a specific version (Default 'latest')
--rrs3d, --remoteresources3decrypt=''
    : install remoteresources3decrypt at a specific version (Default 'latest')
--mtp, --mustachetemplate=''
    : install mustachetemplate at a specific version (Default 'latest')
--ffsld, --featureflagsetld=''
    : install featureflagsetld at a specific version (Default 'latest')
--ms, --managedset=''
    : install managedset at a specific version (Default 'latest')
-a, --autoupdate
    : will create a remoteresource that will pull and keep specified resources updated to latest (even if a version was specified). if no resources specified, will do all known resources.
```

### Remove Job Options

[Code Reference](https://github.com/razee-io/razeedeploy-delta/blob/master/src/remove.js#L33-L49)

```
-h, --help
    : help menu
-n, --namespace=''
    : namespace to remove razeedeploy resources from (Default 'razeedeploy')
--dn, --delete-namespace=''
    : include namespace as a resource to delete (Default false)
-t, --timeout
    : time (minutes) before failing to delete CRD (Default 5)
-a, --attempts
    : number of attempts to verify CRD is deleted before failing (Default 5)
-f, --force
    : force delete the CRD and CR instances without allowing the controller to clean up children (Default false)
```
