/**
 * @author Benjamin Berman
 * © 2012 All Rights Reserved
 **/
defaultPreserve = {
    'li[id]':function(node) {
        return node.id;
    }
};

defaultRendered = function () {
    $(this.findAll('ul[data-role="listview"]:not(.ui-listview):visible')).listview();
    $('.ui-listview[data-role="listview"]').listview("refresh");
};

defaultCreated = function() {
    $('ul[data-role="listview"]:not(.ui-listview):visible').listview();
};

createAndRefreshButtons = function () {
    $('[data-role="button"]:visible').button();
};

refreshListviewsAndCreateButtons = function() {
    defaultRendered.apply(this);
    createAndRefreshButtons.apply(this);
};

refreshAll = function() {
    refreshListviewsAndCreateButtons.apply({findAll:document.querySelectorAll});
};