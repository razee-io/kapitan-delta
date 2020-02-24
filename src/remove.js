/**
 * Copyright 2020 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var log = require('./bunyan-api').createLogger('create-rd');
var argv = require('minimist')(process.argv.slice(2));

const { KubeClass, KubeApiConfig } = require('@razee/kubernetes-util');
const kubeApiConfig = KubeApiConfig();
const kc = new KubeClass(kubeApiConfig);

const objectPath = require('object-path');
const yaml = require('js-yaml');
const fs = require('fs-extra');
const axios = require('axios');
const handlebars = require('handlebars');

const argvNamespace = typeof (argv.n || argv.namespace) === 'string' ? argv.n || argv.namespace : 'razeedeploy';

async function main() {
  if (argv.h || argv.help) {
    log.info(`
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
    `);
    return;
  }

  let resourcesObj = {
    'watch-keeper': { remove: argv.wk || argv['watch-keeper'], uri: 'https://github.com/razee-io/watch-keeper/releases/{{install_version}}/resource.yaml' },
    'remoteresource': { remove: argv.rr || argv['remoteresource'], uri: 'https://github.com/razee-io/RemoteResource/releases/{{install_version}}/resource.yaml' },
    'remoteresources3': { remove: argv.rrs3 || argv['remoteresources3'], uri: 'https://github.com/razee-io/RemoteResourceS3/releases/{{install_version}}/resource.yaml' },
    'remoteresources3decrypt': { remove: argv.rrs3d || argv['remoteresources3decrypt'], uri: 'https://github.com/razee-io/RemoteResourceS3Decrypt/releases/{{install_version}}/resource.yaml' },
    'mustachetemplate': { remove: argv.mtp || argv['mustachetemplate'], uri: 'https://github.com/razee-io/MustacheTemplate/releases/{{install_version}}/resource.yaml' },
    'featureflagsetld': { remove: argv.ffsld || argv['featureflagsetld'], uri: 'https://github.com/razee-io/FeatureFlagSetLD/releases/{{install_version}}/resource.yaml' },
    'managedset': { remove: argv.ms || argv['managedset'], uri: 'https://github.com/razee-io/ManagedSet/releases/{{install_version}}/resource.yaml' }
  };

  let dltNamespace = typeof (argv.dn || argv['delete-namespace']) === 'boolean' ? argv.dn || argv['delete-namespace'] : false;
  let force = typeof (argv.f || argv['force']) === 'boolean' ? argv.f || argv['force'] : false;

  let attempts = typeof (argv.a || argv.attempts) === 'number' ? argv.a || argv.attempts : 5;
  let timeout = typeof (argv.t || argv.timeout) === 'number' ? argv.t || argv.timeout : 5;
  let timeoutMillSec = timeout * 60 * 1000;
  let backoff = Math.floor(timeoutMillSec / Math.pow(2, attempts - 1));

  try {
    let resourceUris = Object.values(resourcesObj);
    let resources = Object.keys(resourcesObj);
    let removeAll = resourceUris.reduce((shouldInstallAll, currentValue) => {
      return objectPath.get(currentValue, 'remove') === undefined ? shouldInstallAll : false;
    }, true);

    for (let i = 0; i < resourceUris.length; i++) {
      if (removeAll || resourceUris[i].remove) {
        log.info(`=========== Removing ${resources[i]}:${resourceUris[i].remove} ===========`);
        if (resources[i] === 'watch-keeper') {
          let wkConfigJson = await readYaml('./src/resources/wkConfig.yaml', { desired_namespace: argvNamespace });
          await deleteFile(wkConfigJson);
        }
        let { file } = await download(resourceUris[i]);
        file = yaml.safeLoadAll(file);
        let flatFile = flatten(file);
        let crdIndex = flatFile.findIndex((el) => objectPath.get(el, 'kind') === 'CustomResourceDefinition');
        if (crdIndex >= 0) {
          let crd = flatFile.splice(crdIndex, 1)[0];
          try {
            await deleteFile(crd);
            if (force) {
              await forceCleanupCR(crd);
            } else {
              await crdDeleted(objectPath.get(crd, 'metadata.name'), attempts, backoff);
            }
          } catch (e) {
            log.error(`Timed out trying to safely clean up crd ${objectPath.get(crd, 'metadata.name')}.. use option '-f, --force' to force clean up (note: child resources wont be cleaned up)`);
          }
        }
        await deleteFile(flatFile);
      }
    }

    log.info('=========== Removing Prerequisites ===========');
    let preReqsJson = await readYaml('./src/resources/preReqs.yaml', { desired_namespace: argvNamespace });
    for (let i = 0; i < preReqsJson.length; i++) {
      let preReq = preReqsJson[i];
      let kind = objectPath.get(preReq, 'kind');
      if ((kind.toLowerCase() !== 'namespace') || (kind.toLowerCase() === 'namespace' && dltNamespace)) {
        await deleteFile(preReq);
      } else {
        log.info(`Skipping namespace deletion: --namespace='${argvNamespace}' --delete-namespace='${dltNamespace}'`);
      }
    }

  } catch (e) {
    log.error(e);
  }
}

async function readYaml(path, templateOptions = {}) {
  let yamlFile = await fs.readFile(path, 'utf8');
  let yamlTemplate = handlebars.compile(yamlFile);
  let templatedJson = yaml.safeLoadAll(yamlTemplate(templateOptions));
  return templatedJson;
}

async function forceCleanupCR(crd) {
  let group = objectPath.get(crd, 'spec.group', 'deploy.razee.io');
  let versions = objectPath.get(crd, 'spec.versions', []);
  let kind = objectPath.get(crd, 'spec.names.kind', '');

  for (let i = 0; i < versions.length; i++) {
    let apiVersion = `${group}/${versions[i].name}`;
    let krm = versions[i].storage ? await kc.getKubeResourceMeta(apiVersion, kind, 'get') : undefined;
    if (krm) {
      let crs = await krm.get();
      await deleteFile(crs, true);
    }
  }
}

const pause = (duration) => new Promise(res => setTimeout(res, duration));

async function crdDeleted(name, attempts = 5, backoffInterval = 3750) {
  let krm = await kc.getKubeResourceMeta('apiextensions.k8s.io/v1beta1', 'CustomResourceDefinition', 'get');
  let crdDltd = (await krm.get(name, undefined, { simple: false, resolveWithFullResponse: true })).statusCode === 404 ? true : false;
  if (crdDltd) {
    log.info(`Successfully deleted ${name}`);
    return;
  } else if (--attempts <= 0) {
    throw Error(`Failed to delete ${name}`);
  } else {
    log.warn(`CRD ${name} not fully removed.. re-checking in: ${backoffInterval/1000} sec, attempts remaining: ${attempts}`);
    await pause(backoffInterval);
    return crdDeleted(name, attempts, backoffInterval * 2);
  }
}

async function download(resourceUriObj) {
  let install_version = (typeof resourceUriObj.install === 'string' && resourceUriObj.install.toLowerCase() !== 'latest') ? `download/${resourceUriObj.install}` : 'latest/download';
  let uri = resourceUriObj.uri.replace('{{install_version}}', install_version);
  try {
    log.info(`Downloading ${uri}`);
    return { file: (await axios.get(uri)).data, uri: uri };
  } catch (e) {
    let latestUri = resourceUriObj.uri.replace('{{install_version}}', 'latest/download');
    log.warn(`Failed to download ${uri}.. defaulting to ${latestUri}`);
    return { file: (await axios.get(latestUri)).data, uri: latestUri };
  }
}

function flatten(file) {
  return file.reduce((result, current) => {
    let kind = objectPath.get(current, ['kind'], '');
    let items = objectPath.get(current, ['items']);

    if (Array.isArray(current)) {
      return result.concat(flatten(current));
    } else if (kind.toLowerCase().endsWith('list') && Array.isArray(items)) {
      return result.concat(flatten(items));
    } else {
      return result.concat(current);
    }
  }, []);
}

async function deleteFile(file, force = false) {
  let kind = objectPath.get(file, ['kind'], '');
  let apiVersion = objectPath.get(file, ['apiVersion'], '');
  let items = objectPath.get(file, ['items']);

  if (Array.isArray(file)) {
    for (let i = 0; i < file.length; i++) {
      await deleteFile(file[i], force);
    }
  } else if (kind.toLowerCase().endsWith('list') && Array.isArray(items)) {
    for (let i = 0; i < items.length; i++) {
      await deleteFile(items[i], force);
    }
  } else if (file) {
    let krm = await kc.getKubeResourceMeta(apiVersion, kind, 'delete');
    if (krm) {
      if (!objectPath.has(file, 'metadata.namespace') && krm.namespaced) {
        log.info(`No namespace found for ${kind} ${objectPath.get(file, 'metadata.name')}.. setting namespace: ${argvNamespace}`);
        objectPath.set(file, 'metadata.namespace', argvNamespace);
      }
      try {
        await deleteResource(krm, file, { force: force });
      } catch (e) {
        log.error(e);
      }
    } else {
      log.error(`KubeResourceMeta not found: { kind: ${kind}, apiVersion: ${apiVersion}, name: ${objectPath.get(file, 'metadata.name')}, namespace: ${objectPath.get(file, 'metadata.namespace')} } ... skipping`);
    }
  }
}

async function deleteResource(krm, file, options = {}) {
  let name = objectPath.get(file, 'metadata.name');
  let namespace = objectPath.get(file, 'metadata.namespace');
  let uri = krm.uri({ name: name, namespace: namespace, status: options.status });
  log.info(`Delete ${uri}`);
  let opt = { simple: false, resolveWithFullResponse: true };

  if (options.force) {
    let mrgPtch = await krm.mergePatch(name, namespace, { metadata: { finalizers: null } }, opt);
    if (mrgPtch.statusCode === 200) {
      log.info(`- MergePatch ${mrgPtch.statusCode} ${uri}`);
    } else if (mrgPtch.statusCode === 404) { // not found -> already gone
      log.info(`- MergePatch ${mrgPtch.statusCode} ${uri}`);
      return { statusCode: mrgPtch.statusCode, body: mrgPtch.body };
    } else {
      log.info(`- MergePatch ${mrgPtch.statusCode} ${uri}`);
      return Promise.reject({ statusCode: mrgPtch.statusCode, body: mrgPtch.body });
    }
  }

  let dlt = await krm.delete(name, namespace, opt);
  if (dlt.statusCode === 200) {
    log.info(`- Delete ${dlt.statusCode} ${uri}`);
    return { statusCode: dlt.statusCode, body: dlt.body };
  } else if (dlt.statusCode === 404) { // not found -> already gone
    log.info(`- Delete ${dlt.statusCode} ${uri}`);
    return { statusCode: dlt.statusCode, body: dlt.body };
  } else {
    log.info(`- Delete ${dlt.statusCode} ${uri}`);
    return Promise.reject({ statusCode: dlt.statusCode, body: dlt.body });
  }
}

main().catch(log.error);
